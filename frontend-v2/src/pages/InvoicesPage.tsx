import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatCard } from '../components/ui/stat-card';
import { DetailField } from '../components/ui/detail-field';
import { SlideOver } from '../components/ui/overlay-panel';
import { useToast } from '../components/ui/toast';
import { Input } from '../components/ui/input';
import { SelectInput } from '../components/ui/select-input';
import { PaginationControls } from '../components/ui/pagination';
import { ActionMenu } from '../components/ui/action-menu';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { TableEmptyState } from '../components/ui/data-state';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  type Invoice,
  type InvoiceLotEntry,
  useAddInvoiceAddon,
  useCreateInvoiceReturn,
  useDeleteInvoice,
  useInvoices,
  useResendInvoiceEmail,
  useUpdateInvoice,
} from '../hooks/useInvoices';
import { type InvoiceFollowUpResult, useInvoiceFollowUp, useLatePaymentRisk } from '../hooks/useAI';
import { usePagination } from '../hooks/usePagination';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AiInsightBanner } from '../components/ui/ai-insight-banner';

type InvoiceStatus = 'pending' | 'sent' | 'delivered' | 'paid' | 'overdue' | 'void' | 'other';
type InvoiceBulkStatus = Exclude<InvoiceStatus, 'other'>;

const statusColors = {
  pending: 'gray',
  sent: 'blue',
  delivered: 'green',
  paid: 'green',
  overdue: 'red',
  void: 'gray',
} as const;

const riskColors = {
  high: 'red',
  medium: 'yellow',
  low: 'green',
} as const;

function normalizeStatus(value: string | undefined): InvoiceStatus {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'pending' || s === 'draft') return 'pending';
  if (s === 'signed' || s === 'sent') return 'sent';
  if (s === 'delivered') return 'delivered';
  if (s === 'paid') return 'paid';
  if (s === 'overdue') return 'overdue';
  if (s === 'void' || s === 'cancelled' || s === 'canceled') return 'void';
  return 'other';
}

function invoiceId(inv: Invoice): string {
  return String(inv.invoiceNumber || inv.invoice_number || inv.id || '-');
}
function customerName(inv: Invoice): string {
  return String(inv.customerName || inv.customer_name || inv.customerId || inv.customer_id || '-');
}
function formatAmount(val: number | string | undefined): string {
  const n = Number(val);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
}
function formatDate(val: string | undefined): string {
  if (!val) return '-';
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '-';
}
function dateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function invoiceActivityDate(invoice: Invoice): string | undefined {
  return invoice.issuedDate || invoice.issued_date || invoice.issueDate || invoice.issue_date || invoice.created_at;
}
function isSameLocalDay(value: string | undefined, dayKey: string): boolean {
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10) === dayKey;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10) === dayKey;
  return dateInputValue(date) === dayKey;
}
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function lotSummary(lots: InvoiceLotEntry[] | undefined): string {
  if (!lots || lots.length === 0) return '-';
  return lots.map((l) => l.lot_number).filter(Boolean).join(', ');
}
function totalLotQuantity(lots: InvoiceLotEntry[] | undefined): number {
  return (lots || []).reduce((sum, lot) => sum + Number(lot.qty || 0), 0);
}
function totalLotWeight(lots: InvoiceLotEntry[] | undefined): number {
  return (lots || []).reduce((sum, lot) => sum + Number(lot.weight || 0), 0);
}
function invoicePrintBlocked(invoice: Invoice): boolean {
  return invoice.estimated_weight_pending === true;
}
function dueDateForInvoice(invoice: Invoice): string | undefined {
  return invoice.dueDate || invoice.due_date;
}
function daysPastDue(invoice: Invoice): number {
  const dueDate = dueDateForInvoice(invoice);
  if (!dueDate) return 0;
  const dueMs = new Date(dueDate).getTime();
  if (!Number.isFinite(dueMs)) return 0;
  return Math.max(0, Math.round((Date.now() - dueMs) / 86400000));
}
function shouldSuggestFollowUp(invoice: Invoice): boolean {
  return normalizeStatus(invoice.status) === 'overdue' || daysPastDue(invoice) > 0;
}
function toneLabel(tone: InvoiceFollowUpResult['tone'] | undefined): string {
  if (!tone) return 'Draft pending';
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}

export function InvoicesPage() {
  const navigate = useNavigate();
  const { data: invoices = [], isLoading, isError, error, refetch } = useInvoices();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const resendInvoiceEmail = useResendInvoiceEmail();
  const addInvoiceAddon = useAddInvoiceAddon();
  const createInvoiceReturn = useCreateInvoiceReturn();
  const latePaymentRisk = useLatePaymentRisk(true);
  const { isPending: invoiceFollowUpPending, mutate: mutateInvoiceFollowUp } = useInvoiceFollowUp();

  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [search, setSearch] = useState('');
  const [activeDate, setActiveDate] = useState(() => dateInputValue());
  const [deliveredOpen, setDeliveredOpen] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Invoice>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState<InvoiceFollowUpResult | null>(null);
  const [followUpInvoiceId, setFollowUpInvoiceId] = useState<string | null>(null);
  const [followUpError, setFollowUpError] = useState('');
  const [markingPaidInvoiceId, setMarkingPaidInvoiceId] = useState<string | null>(null);
  const [markingDeliveredInvoiceId, setMarkingDeliveredInvoiceId] = useState<string | null>(null);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(() => new Set());
  const [bulkInvoiceStatus, setBulkInvoiceStatus] = useState<InvoiceBulkStatus>('delivered');
  const [bulkUpdatingInvoices, setBulkUpdatingInvoices] = useState(false);
  const [activeInvoicePageSize, setActiveInvoicePageSize] = useState(25);
  const [deliveredInvoicePageSize, setDeliveredInvoicePageSize] = useState(25);
  const [addonDraft, setAddonDraft] = useState({ product_id: '', qty: '1', uom: 'each', price: '', reason: '' });
  const [returnDraft, setReturnDraft] = useState({ amount: '', reason: '' });

  const riskByCustomer = useMemo(() => {
    return new Map((latePaymentRisk.data?.risks || []).map((risk) => [risk.customer_name.toLowerCase(), risk]));
  }, [latePaymentRisk.data]);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && normalizeStatus(inv.status) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const lotMatch = (inv.lot_numbers || []).some((l) => l.lot_number?.toLowerCase().includes(q));
        const matches =
          invoiceId(inv).toLowerCase().includes(q) ||
          customerName(inv).toLowerCase().includes(q) ||
          String(inv.orderNumber || inv.order_number || inv.orderId || inv.order_id || '').toLowerCase().includes(q) ||
          lotMatch;
        if (!matches) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, search]);

  const summary = useMemo(() => ({
    total: invoices.length,
    paid: invoices.filter((i) => normalizeStatus(i.status) === 'paid').length,
    overdue: invoices.filter((i) => normalizeStatus(i.status) === 'overdue').length,
    outstanding: invoices.filter((i) => ['pending', 'sent', 'delivered'].includes(normalizeStatus(i.status))).length,
  }), [invoices]);

  const activeInvoicesForDay = useMemo(() => {
    return filtered.filter((invoice) => {
      const status = normalizeStatus(invoice.status);
      return status !== 'delivered' && isSameLocalDay(invoiceActivityDate(invoice), activeDate);
    });
  }, [activeDate, filtered]);

  const deliveredInvoices = useMemo(() => {
    return filtered.filter((invoice) => normalizeStatus(invoice.status) === 'delivered');
  }, [filtered]);

  const activeInvoicePagination = usePagination(activeInvoicesForDay, activeInvoicePageSize);
  const deliveredInvoicePagination = usePagination(deliveredInvoices, deliveredInvoicePageSize);

  const activeInvoiceIds = useMemo(
    () => activeInvoicePagination.pageItems.map((invoice) => String(invoice.id || '')).filter(Boolean),
    [activeInvoicePagination.pageItems],
  );
  const selectedVisibleInvoiceIds = activeInvoiceIds.filter((id) => selectedInvoiceIds.has(id));
  const allVisibleInvoicesSelected = activeInvoiceIds.length > 0 && selectedVisibleInvoiceIds.length === activeInvoiceIds.length;

  const topRisks = useMemo(() => (latePaymentRisk.data?.risks || []).slice(0, 3), [latePaymentRisk.data]);
  const selectedRisk = selected ? riskByCustomer.get(customerName(selected).toLowerCase()) : undefined;

  useEffect(() => {
    const visibleIds = new Set(activeInvoiceIds);
    setSelectedInvoiceIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [activeInvoiceIds]);

  useEffect(() => {
    if (!selected) {
      setFollowUpDraft(null);
      setFollowUpInvoiceId(null);
      setFollowUpError('');
      return;
    }
    const selectedId = String(selected.id || '');
    if (!selectedId || !shouldSuggestFollowUp(selected)) return;
    if (invoiceFollowUpPending) return;
    if (followUpInvoiceId === selectedId && followUpDraft) return;

    setFollowUpError('');
    mutateInvoiceFollowUp(selectedId, {
      onSuccess: (result) => {
        setFollowUpDraft(result);
        setFollowUpInvoiceId(selectedId);
      },
      onError: (mutationError) => {
        setFollowUpDraft(null);
        setFollowUpInvoiceId(selectedId);
        setFollowUpError(String((mutationError as Error)?.message || 'Could not build invoice follow-up'));
      },
    });
  }, [followUpDraft, followUpInvoiceId, invoiceFollowUpPending, mutateInvoiceFollowUp, selected]);

  function openInvoice(inv: Invoice) {
    setSelected(inv);
    setDraft({ ...inv });
    setEditing(false);
    setConfirmDelete(false);
    setFollowUpError('');
    setAddonDraft({ product_id: '', qty: '1', uom: 'each', price: '', reason: '' });
    setReturnDraft({ amount: '', reason: '' });
    if (followUpInvoiceId !== String(inv.id || '')) {
      setFollowUpDraft(null);
    }
  }

  function printInvoiceSummary(invoice: Invoice) {
    const popup = window.open('', '_blank', 'width=1100,height=900');
    if (!popup) return;
    const merged = { ...invoice, ...draft };
    const lots = merged.lot_numbers || [];
    const rows = lots.length
      ? lots.map((lot) => `
        <tr>
          <td>${escapeHtml(lot.item_number || '-')}</td>
          <td>${escapeHtml(lot.description || '-')}</td>
          <td>${escapeHtml(lot.lot_number || '-')}</td>
          <td class="num">${escapeHtml(lot.qty ?? '-')}</td>
          <td class="num">${lot.weight != null ? `${escapeHtml(lot.weight)} lbs` : '-'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="empty">No lot details were recorded for this invoice.</td></tr>';

    popup.document.write(`<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Invoice ${escapeHtml(invoiceId(merged))}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 28px; color: #111827; }
            h1 { margin: 0 0 6px; font-size: 28px; }
            .subtitle { color: #4b5563; margin-bottom: 20px; }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
            .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px 14px; background: #f9fafb; }
            .label { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
            .value { margin-top: 4px; font-size: 18px; font-weight: 700; color: #111827; }
            .notes { margin: 20px 0; padding: 14px; border-radius: 10px; border: 1px solid #d1d5db; background: #f9fafb; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #d1d5db; padding: 10px 12px; text-align: left; font-size: 12px; }
            th { background: #eef2ff; }
            .num { text-align: right; }
            .empty { color: #6b7280; text-align: center; }
            @media print { body { margin: 14px; } }
          </style>
        </head>
        <body>
          <h1>Invoice ${escapeHtml(invoiceId(merged))}</h1>
          <div class="subtitle">${escapeHtml(customerName(merged))} · Order ${escapeHtml(merged.orderId || merged.order_id || '-')}</div>
          <div class="summary">
            <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(String(merged.status || 'draft'))}</div></div>
            <div class="card"><div class="label">Amount</div><div class="value">${escapeHtml(formatAmount(merged.amount))}</div></div>
            <div class="card"><div class="label">Issued / Due</div><div class="value">${escapeHtml(formatDate(merged.issuedDate || merged.issued_date))} / ${escapeHtml(formatDate(merged.dueDate || merged.due_date))}</div></div>
            <div class="card"><div class="label">Lots</div><div class="value">${lots.length.toLocaleString()}</div></div>
            <div class="card"><div class="label">Requested Qty</div><div class="value">${totalLotQuantity(lots).toLocaleString()}</div></div>
            <div class="card"><div class="label">Weight Total</div><div class="value">${totalLotWeight(lots).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} lbs</div></div>
          </div>
          <div class="notes"><strong>Notes:</strong> ${escapeHtml(merged.notes || 'No invoice notes recorded.')}</div>
          <h2>Lot Summary</h2>
          <table>
            <thead>
              <tr>
                <th>Item #</th>
                <th>Description</th>
                <th>Lot #</th>
                <th class="num">Qty</th>
                <th class="num">Weight</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  function handleDelete() {
    const id = selected?.id;
    if (!id) return;
    deleteInvoice.mutate(id, {
      onSuccess: () => {
        toast.success(`Invoice ${invoiceId(selected!)} deleted.`);
        setSelected(null);
        setConfirmDelete(false);
      },
    });
  }

  function saveInvoice() {
    const id = selected?.id;
    if (!id) return;
    updateInvoice.mutate(
      { id, patch: draft as Record<string, unknown> },
      {
        onSuccess: () => {
          setSelected({ ...selected!, ...draft });
          setEditing(false);
          toast.success(`Invoice ${invoiceId(selected!)} saved.`);
        },
      }
    );
  }

  function resendInvoice(inv: Invoice) {
    const id = inv.id;
    if (!id) return;
    resendInvoiceEmail.mutate(id, {
      onSuccess: () => {        toast.success(`Invoice ${invoiceId(inv)} emailed.`);
      },
      onError: (mutationError) => {        toast.error(String((mutationError as Error)?.message || 'Could not resend invoice email'));
      },
    });
  }

  function markInvoicePaid(inv: Invoice) {
    const id = inv.id;
    if (!id || normalizeStatus(inv.status) === 'paid') return;
    const idString = String(id);    setMarkingPaidInvoiceId(idString);
    updateInvoice.mutate(
      { id, patch: { status: 'paid' } },
      {
        onSuccess: (updated) => {
          const paidInvoice = { ...inv, ...(updated as Partial<Invoice>), status: 'paid' };
          if (selected && String(selected.id || '') === idString) {
            setSelected({ ...selected, ...paidInvoice });
            setDraft((current) => ({ ...current, ...paidInvoice }));
          }
          toast.success(`Invoice ${invoiceId(inv)} marked paid.`);
        },
        onError: (mutationError) => {
          toast.error(String((mutationError as Error)?.message || 'Could not mark invoice paid'));
        },
        onSettled: () => {
          setMarkingPaidInvoiceId(null);
        },
      }
    );
  }

  function markInvoiceDelivered(inv: Invoice) {
    const id = inv.id;
    const status = normalizeStatus(inv.status);
    if (!id || status === 'delivered' || status === 'paid') return;
    const idString = String(id);    setMarkingDeliveredInvoiceId(idString);
    updateInvoice.mutate(
      { id, patch: { status: 'delivered' } },
      {
        onSuccess: (updated) => {
          const deliveredInvoice = { ...inv, ...(updated as Partial<Invoice>), status: 'delivered' };
          if (selected && String(selected.id || '') === idString) {
            setSelected({ ...selected, ...deliveredInvoice });
            setDraft((current) => ({ ...current, ...deliveredInvoice }));
          }
          toast.success(`Invoice ${invoiceId(inv)} marked delivered.`);
        },
        onError: (mutationError) => {
          toast.error(String((mutationError as Error)?.message || 'Could not mark invoice delivered'));
        },
        onSettled: () => {
          setMarkingDeliveredInvoiceId(null);
        },
      }
    );
  }

  function toggleInvoiceSelected(invoice: Invoice, checked: boolean) {
    const id = String(invoice.id || '');
    if (!id) return;
    setSelectedInvoiceIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisibleInvoices(checked: boolean) {
    setSelectedInvoiceIds((current) => {
      const next = new Set(current);
      for (const id of activeInvoiceIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function applyBulkInvoiceStatus() {
    if (!selectedVisibleInvoiceIds.length) return;
    const statusLabel = bulkInvoiceStatus.replace('_', ' ');
    if (!confirm(`Mark ${selectedVisibleInvoiceIds.length} invoice${selectedVisibleInvoiceIds.length === 1 ? '' : 's'} as ${statusLabel}?`)) return;
    setBulkUpdatingInvoices(true);
    try {
      await Promise.all(selectedVisibleInvoiceIds.map((id) => updateInvoice.mutateAsync({ id, patch: { status: bulkInvoiceStatus } })));
      setSelectedInvoiceIds(new Set());
      toast.success(`${selectedVisibleInvoiceIds.length} invoice${selectedVisibleInvoiceIds.length === 1 ? '' : 's'} marked ${statusLabel}.`);
      await refetch();
    } catch (mutationError) {
      toast.error(String((mutationError as Error)?.message || 'Could not update selected invoices'));
    } finally {
      setBulkUpdatingInvoices(false);
    }
  }

  function generateFollowUpForInvoice(inv: Invoice) {
    const id = String(inv.id || '');
    if (!id) return;
    setFollowUpError('');
    setFollowUpDraft(null);
    setFollowUpInvoiceId(id);
    openInvoice(inv);
    mutateInvoiceFollowUp(id, {
      onSuccess: (result) => {
        setFollowUpDraft(result);
        setFollowUpInvoiceId(id);
      },
      onError: (mutationError) => {
        setFollowUpDraft(null);
        setFollowUpInvoiceId(id);
        setFollowUpError(String((mutationError as Error)?.message || 'Could not build invoice follow-up'));
      },
    });
  }

  async function copyFollowUp() {
    if (!followUpDraft) return;
    const content = `Subject: ${followUpDraft.subject}\n\n${followUpDraft.body}`;
    try {
      await navigator.clipboard.writeText(content);
      toast.success(selected ? `AI follow-up copied for invoice ${invoiceId(selected)}.` : 'AI follow-up copied.');
    } catch {
      toast.error('Could not copy follow-up to clipboard');
    }
  }

  function submitAddon() {
    const id = selected?.id;
    if (!id || !addonDraft.product_id.trim()) {
      toast.error('Product ID is required for an add-on.');
      return;
    }    addInvoiceAddon.mutate(
      {
        id,
        payload: {
          product_id: addonDraft.product_id.trim(),
          qty: Number(addonDraft.qty) || 1,
          uom: addonDraft.uom.trim() || null,
          price: addonDraft.price.trim() ? Number(addonDraft.price) : undefined,
          reason: addonDraft.reason.trim() || null,
        },
      },
      {
        onSuccess: (result) => {
          if (result.invoice && selected) {
            setSelected({ ...selected, ...result.invoice });
            setDraft((current) => ({ ...current, ...result.invoice }));
          }
          setAddonDraft({ product_id: '', qty: '1', uom: 'each', price: '', reason: '' });
          toast.success(`Add-on saved for invoice ${selected ? invoiceId(selected) : ''}.`);
        },
        onError: (mutationError) => {
          toast.error(String((mutationError as Error)?.message || 'Could not add invoice item'));
        },
      },
    );
  }

  function submitReturnCredit() {
    const id = selected?.id;
    if (!id || !returnDraft.reason.trim()) {
      toast.error('Return reason is required.');
      return;
    }    createInvoiceReturn.mutate(
      {
        id,
        payload: {
          amount: Number(returnDraft.amount) || 0,
          reason: returnDraft.reason.trim(),
        },
      },
      {
        onSuccess: () => {
          setReturnDraft({ amount: '', reason: '' });
          toast.success(`Credit memo issued for invoice ${selected ? invoiceId(selected) : ''}.`);
        },
        onError: (mutationError) => {
          toast.error(String((mutationError as Error)?.message || 'Could not create return credit'));
        },
      },
    );
  }

  function renderInvoiceRows(rows: Invoice[], emptyMessage: string, selectable = false) {
    return rows.length ? rows.map((inv) => {
      const status = normalizeStatus(inv.status);
      const isDelivered = status === 'delivered';
      const isPaid = status === 'paid';
      const risk = riskByCustomer.get(customerName(inv).toLowerCase());
      const selectableId = String(inv.id || '');
      return (
        <TableRow key={invoiceId(inv)}>
          {selectable ? (
            <TableCell>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean(selectableId && selectedInvoiceIds.has(selectableId))}
                onChange={(event) => toggleInvoiceSelected(inv, event.target.checked)}
                aria-label={`Select invoice ${invoiceId(inv)}`}
                disabled={!selectableId || bulkUpdatingInvoices}
              />
            </TableCell>
          ) : null}
          <TableCell className="font-medium whitespace-nowrap">{invoiceId(inv)}</TableCell>
          <TableCell className="max-w-[140px] truncate">{customerName(inv)}</TableCell>
          <TableCell className="hidden sm:table-cell">
            {risk ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={risk.risk_level.toLowerCase()} colorMap={riskColors} fallbackLabel={risk.risk_level} />
                <span className="text-xs text-muted-foreground">{risk.risk_score}</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">No flag</span>
            )}
          </TableCell>
          <TableCell className="hidden sm:table-cell">{inv.orderNumber || inv.order_number || inv.orderId || inv.order_id || '-'}</TableCell>
          <TableCell className="hidden sm:table-cell font-mono text-xs">{lotSummary(inv.lot_numbers)}</TableCell>
          <TableCell className="whitespace-nowrap">{formatAmount(inv.amount)}</TableCell>
          <TableCell><StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
          <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(invoiceActivityDate(inv))}</TableCell>
          <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(inv.dueDate || inv.due_date)}</TableCell>
          <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(inv.paidDate || inv.paid_date)}</TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              <Button size="sm" className="whitespace-nowrap" onClick={() => openInvoice(inv)}>View / Edit</Button>
              <ActionMenu
                items={[
                  {
                    label: updateInvoice.isPending && markingDeliveredInvoiceId === String(inv.id || '') ? 'Saving...' : 'Delivered',
                    onClick: () => markInvoiceDelivered(inv),
                    disabled: isDelivered || isPaid || (updateInvoice.isPending && markingDeliveredInvoiceId === String(inv.id || '')),
                  },
                  {
                    label: updateInvoice.isPending && markingPaidInvoiceId === String(inv.id || '') ? 'Saving...' : 'PAID',
                    onClick: () => markInvoicePaid(inv),
                    disabled: isPaid || (updateInvoice.isPending && markingPaidInvoiceId === String(inv.id || '')),
                  },
                  {
                    label: resendInvoiceEmail.isPending ? 'Sending...' : 'Resend Email',
                    onClick: () => resendInvoice(inv),
                    disabled: resendInvoiceEmail.isPending,
                  },
                  {
                    label: invoiceFollowUpPending && followUpInvoiceId === String(inv.id || '') ? 'Drafting...' : 'AI Follow-Up',
                    onClick: () => generateFollowUpForInvoice(inv),
                    disabled: invoiceFollowUpPending && followUpInvoiceId === String(inv.id || ''),
                    hidden: !shouldSuggestFollowUp(inv),
                  },
                ]}
              />
            </div>
          </TableCell>
        </TableRow>
      );
    }) : (
      <TableEmptyState
        colSpan={selectable ? 12 : 11}
        title={emptyMessage}
        description={selectable ? 'Create an order to generate invoices for the selected day.' : 'Delivered invoices appear here after fulfillment is marked complete.'}
        actionLabel="Create Order"
        onAction={() => navigate('/orders')}
      />
    );
  }

  function invoiceTable(
    rows: Invoice[],
    emptyMessage: string,
    selectable = false,
    pagination?: {
      page: number;
      pageCount: number;
      setPage: (page: number) => void;
      itemCount: number;
      pageSize: number;
    },
    onPageSizeChange?: (pageSize: number) => void,
  ) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        {selectable ? (
          <div className="flex flex-col gap-2 border-b border-border bg-muted/20 p-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={allVisibleInvoicesSelected}
                onChange={(event) => toggleAllVisibleInvoices(event.target.checked)}
                aria-label="Select all visible invoices"
                disabled={!activeInvoiceIds.length || bulkUpdatingInvoices}
              />
              Select All
              <span className="text-xs font-normal text-muted-foreground">
                {selectedVisibleInvoiceIds.length} selected
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <SelectInput
                value={bulkInvoiceStatus}
                onChange={(event) => setBulkInvoiceStatus(event.target.value as InvoiceBulkStatus)}
                className="h-9 px-2"
                aria-label="Bulk invoice status"
                disabled={!selectedVisibleInvoiceIds.length || bulkUpdatingInvoices}
              >
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="void">Voided</option>
              </SelectInput>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void applyBulkInvoiceStatus()}
                disabled={!selectedVisibleInvoiceIds.length || bulkUpdatingInvoices}
              >
                {bulkUpdatingInvoices ? 'Updating...' : 'Apply Bulk Status'}
              </Button>
            </div>
          </div>
        ) : null}
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              {selectable ? (
                <TableHead className="w-10">
                  <span className="sr-only">Select</span>
                </TableHead>
              ) : null}
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden sm:table-cell">AI Risk</TableHead>
              <TableHead className="hidden sm:table-cell">Order #</TableHead>
              <TableHead className="hidden sm:table-cell">Lot #(s)</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Issued</TableHead>
              <TableHead className="hidden md:table-cell">Due</TableHead>
              <TableHead className="hidden md:table-cell">Paid</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{renderInvoiceRows(rows, emptyMessage, selectable)}</TableBody>
        </Table>
        {pagination && pagination.itemCount ? (
          <PaginationControls
            page={pagination.page}
            pageCount={pagination.pageCount}
            setPage={pagination.setPage}
            itemCount={pagination.itemCount}
            pageSize={pagination.pageSize}
            onPageSizeChange={onPageSizeChange}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AiInsightBanner types={['collections']} />
      {isLoading ? <PageSkeleton /> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load invoices')}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total" value={summary.total.toLocaleString()} />
        <StatCard label="Paid" value={summary.paid.toLocaleString()} />
        <StatCard label="Overdue" value={summary.overdue.toLocaleString()} />
        <StatCard label="Outstanding" value={summary.outstanding.toLocaleString()} />
      </div>

      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 via-background to-red-50">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>AI Collections Monitor</CardTitle>
            <CardDescription>
              {latePaymentRisk.data?.summary || 'Late-payment risk is analyzed automatically so AR can prioritize outreach.'}
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => latePaymentRisk.refetch()} disabled={latePaymentRisk.isFetching}>
            {latePaymentRisk.isFetching ? 'Refreshing...' : 'Refresh AI Risk'}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-border bg-background/90 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority Accounts</div>
            <div className="mt-3 space-y-3">
              {topRisks.length ? topRisks.map((risk) => (
                <div key={risk.customer_name} className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{risk.customer_name}</div>
                      <div className="text-sm text-muted-foreground">{risk.flag_reason}</div>
                    </div>
                    <StatusBadge status={risk.risk_level.toLowerCase()} colorMap={riskColors} fallbackLabel={risk.risk_level} />
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">Recommended action: {risk.recommended_action}</div>
                </div>
              )) : (
                <div className="text-sm text-muted-foreground">
                  {latePaymentRisk.isLoading ? 'Analyzing open AR...' : 'No at-risk accounts were returned.'}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/90 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Workflow Coverage</div>
            <div className="mt-3 space-y-3 text-sm text-foreground">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
                Risk scoring is now live on the invoices screen and refreshes against current AR.
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950">
                Overdue invoices can generate customer-ready follow-up drafts directly from the detail drawer.
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
                Selecting an overdue invoice will proactively prepare a follow-up so AR can act faster.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Active Invoices</CardTitle>
            <CardDescription>Undelivered invoices for the selected day. Delivered invoices move into the dropdown below.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day</span>
              <Input type="date" value={activeDate} onChange={(e) => setActiveDate(e.target.value)} className="w-40" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | InvoiceStatus)}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="void">Voided</option>
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input placeholder="Invoice #, customer, lot #..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-52" />
            </label>
            <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          {invoiceTable(activeInvoicePagination.pageItems, 'No active invoices found for this day.', true, activeInvoicePagination, setActiveInvoicePageSize)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle>Delivered Invoices</CardTitle>
            <CardDescription>Completed deliveries are kept here for review and follow-up.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => setDeliveredOpen((open) => !open)}>
            {deliveredOpen ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
            {deliveredOpen ? 'Hide' : 'Show'} Delivered ({deliveredInvoices.length})
          </Button>
        </CardHeader>
        {deliveredOpen ? (
          <CardContent className="p-0 sm:p-2">
            {invoiceTable(deliveredInvoicePagination.pageItems, 'No delivered invoices match the current filters.', false, deliveredInvoicePagination, setDeliveredInvoicePageSize)}
          </CardContent>
        ) : null}
      </Card>

      {selected && (() => {
        const selStatus = normalizeStatus(selected.status);
        const selDelivered = selStatus === 'delivered';
        const selPaid = selStatus === 'paid';
        return (
          <SlideOver
            open
            title={invoiceId(selected)}
            description={customerName(selected)}
            onClose={() => { setSelected(null); setConfirmDelete(false); }}
            widthClassName="max-w-2xl"
            actions={
              <div className="flex flex-wrap items-center justify-end gap-2">
                  {!confirmDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      className={selDelivered ? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100' : ''}
                      disabled={selDelivered || selPaid || (updateInvoice.isPending && markingDeliveredInvoiceId === String(selected.id || ''))}
                      onClick={() => markInvoiceDelivered(selected)}
                    >
                      {updateInvoice.isPending && markingDeliveredInvoiceId === String(selected.id || '') ? 'Saving...' : 'Delivered'}
                    </Button>
                  )}
                  {!confirmDelete && (
                    <Button
                      size="sm"
                      variant={selPaid ? 'outline' : 'default'}
                      disabled={selPaid || (updateInvoice.isPending && markingPaidInvoiceId === String(selected.id || ''))}
                      onClick={() => markInvoicePaid(selected)}
                    >
                      {updateInvoice.isPending && markingPaidInvoiceId === String(selected.id || '') ? 'Saving...' : 'PAID'}
                    </Button>
                  )}
                  {!confirmDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={invoicePrintBlocked(selected)}
                      onClick={() => {
                        if (invoicePrintBlocked(selected)) {
                          toast.success(`Invoice ${invoiceId(selected)} cannot be printed until final weights are entered.`);
                          return;
                        }
                        printInvoiceSummary(selected);
                      }}
                    >
                      Print / Save PDF
                    </Button>
                  )}
                  {!confirmDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resendInvoiceEmail.isPending}
                      onClick={() => resendInvoice(selected)}
                    >
                      {resendInvoiceEmail.isPending ? 'Sending...' : 'Resend Email'}
                    </Button>
                  )}
                  {!editing && !confirmDelete && shouldSuggestFollowUp(selected) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={invoiceFollowUpPending && followUpInvoiceId === String(selected.id || '')}
                      onClick={() => generateFollowUpForInvoice(selected)}
                    >
                      {invoiceFollowUpPending && followUpInvoiceId === String(selected.id || '') ? 'Drafting...' : 'Refresh AI Draft'}
                    </Button>
                  )}
                  {!editing && !confirmDelete && (
                    <>
                      <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>Delete</Button>
                    </>
                  )}
                  {editing && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); }}>Cancel</Button>
                      <Button size="sm" disabled={updateInvoice.isPending} onClick={saveInvoice}>{updateInvoice.isPending ? 'Saving...' : 'Save'}</Button>
                    </>
                  )}
                  {confirmDelete && (
                    <>
                      <span className="self-center text-sm text-destructive">Delete?</span>
                      <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>No</Button>
                      <Button size="sm" disabled={deleteInvoice.isPending} onClick={handleDelete}>{deleteInvoice.isPending ? 'Deleting...' : 'Yes'}</Button>
                    </>
                  )}
              </div>
            }
          >
            <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice Summary</div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div>Status: <strong className="capitalize">{String(selected.status || 'pending').replace('_', ' ')}</strong></div>
                      <div>Amount: <strong>{formatAmount(draft.amount)}</strong></div>
                      <div>Issued: <strong>{formatDate(selected.created_at || selected.issuedDate || selected.issued_date)}</strong></div>
                      <div>Due: <strong>{formatDate(draft.dueDate || draft.due_date)}</strong></div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fulfillment Summary</div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div>Lots tracked: <strong>{(selected.lot_numbers || []).length.toLocaleString()}</strong></div>
                      <div>Total lot qty: <strong>{totalLotQuantity(selected.lot_numbers).toLocaleString()}</strong></div>
                      <div>Total weight: <strong>{totalLotWeight(selected.lot_numbers).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} lbs</strong></div>
                      <div>Printable record: <strong>{invoicePrintBlocked(selected) ? 'Waiting on final weights' : 'Ready'}</strong></div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Collections Risk</div>
                    <div className="mt-2 space-y-2 text-sm">
                      {selectedRisk ? (
                        <>
                          <StatusBadge status={selectedRisk.risk_level.toLowerCase()} colorMap={riskColors} fallbackLabel={selectedRisk.risk_level} />
                          <div>Risk score: <strong>{selectedRisk.risk_score}</strong></div>
                          <div>{selectedRisk.flag_reason}</div>
                          <div className="text-muted-foreground">{selectedRisk.recommended_action}</div>
                        </>
                      ) : (
                        <div className="text-muted-foreground">No AI risk flag for this customer right now.</div>
                      )}
                    </div>
                  </div>
                </div>

                {invoicePrintBlocked(selected) ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Print is locked for this invoice because weight-based items are still marked as estimated. Finish final weight entry before creating a customer-facing PDF.
                  </div>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Add-Ons and Credits</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_100px_100px_100px]">
                      <Input
                        placeholder="Product ID"
                        value={addonDraft.product_id}
                        onChange={(event) => setAddonDraft((current) => ({ ...current, product_id: event.target.value }))}
                      />
                      <Input
                        placeholder="Qty"
                        type="number"
                        min="0"
                        step="0.01"
                        value={addonDraft.qty}
                        onChange={(event) => setAddonDraft((current) => ({ ...current, qty: event.target.value }))}
                      />
                      <Input
                        placeholder="UOM"
                        value={addonDraft.uom}
                        onChange={(event) => setAddonDraft((current) => ({ ...current, uom: event.target.value }))}
                      />
                      <Input
                        placeholder="Price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={addonDraft.price}
                        onChange={(event) => setAddonDraft((current) => ({ ...current, price: event.target.value }))}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="min-w-64 flex-1"
                        placeholder="Add-on reason"
                        value={addonDraft.reason}
                        onChange={(event) => setAddonDraft((current) => ({ ...current, reason: event.target.value }))}
                      />
                      <Button size="sm" onClick={submitAddon} disabled={addInvoiceAddon.isPending}>
                        {addInvoiceAddon.isPending ? 'Saving...' : 'Add to Invoice'}
                      </Button>
                    </div>
                    <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-[120px_minmax(0,1fr)_auto]">
                      <Input
                        placeholder="Amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={returnDraft.amount}
                        onChange={(event) => setReturnDraft((current) => ({ ...current, amount: event.target.value }))}
                      />
                      <Input
                        placeholder="Return reason"
                        value={returnDraft.reason}
                        onChange={(event) => setReturnDraft((current) => ({ ...current, reason: event.target.value }))}
                      />
                      <Button size="sm" variant="outline" onClick={submitReturnCredit} disabled={createInvoiceReturn.isPending}>
                        {createInvoiceReturn.isPending ? 'Issuing...' : 'Issue Credit'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {shouldSuggestFollowUp(selected) ? (
                  <Card className="border-blue-200 bg-blue-50/60">
                    <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <CardTitle className="text-base">AI Follow-Up Draft</CardTitle>
                        <CardDescription>
                          {followUpDraft
                            ? `${toneLabel(followUpDraft.tone)} tone drafted for ${followUpDraft.days_overdue ?? daysPastDue(selected)} day(s) overdue.`
                            : 'This invoice is overdue, so AI is preparing a customer-ready collection email.'}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={invoiceFollowUpPending && followUpInvoiceId === String(selected.id || '')}
                          onClick={() => generateFollowUpForInvoice(selected)}
                        >
                          {invoiceFollowUpPending && followUpInvoiceId === String(selected.id || '') ? 'Drafting...' : 'Regenerate'}
                        </Button>
                        <Button size="sm" onClick={() => void copyFollowUp()} disabled={!followUpDraft}>
                          Copy Draft
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {followUpError ? (
                        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{followUpError}</div>
                      ) : null}
                      {followUpDraft ? (
                        <>
                          <div className="rounded-lg border border-border bg-background px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</div>
                            <div className="mt-2 text-sm font-medium">{followUpDraft.subject}</div>
                          </div>
                          <div className="rounded-lg border border-border bg-background px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</div>
                            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-foreground">{followUpDraft.body}</pre>
                          </div>
                          <div className="rounded-lg border border-border bg-background px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AR Notes</div>
                            <div className="mt-2 space-y-2">
                              {(followUpDraft.key_points || []).map((point, index) => (
                                <div key={`${point}-${index}`} className="text-sm text-foreground">{point}</div>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                          {invoiceFollowUpPending && followUpInvoiceId === String(selected.id || '') ? 'Generating follow-up draft...' : 'Open an overdue invoice to generate a follow-up.'}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : null}

                <DetailField label="Invoice #" value={draft.invoiceNumber || draft.invoice_number} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, invoiceNumber: v }))} />
                <DetailField label="Customer" value={draft.customerName || draft.customer_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, customerName: v }))} />
                <div className="flex items-start gap-3">
                  <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Order Date</span>
                  <span className="text-sm">{formatDate(selected.created_at || selected.issuedDate || selected.issued_date)}</span>
                </div>
                <DetailField label="Amount" value={String(draft.amount ?? '')} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
                <div className="flex items-start gap-3">
                  <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                  {editing ? (
                    <SelectInput value={draft.status || ''} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1">
                      <option value="pending">Pending</option>
                      <option value="sent">Sent</option>
                      <option value="delivered">Delivered</option>
                      <option value="paid">Paid</option>
                      <option value="overdue">Overdue</option>
                      <option value="void">Voided</option>
                    </SelectInput>
                  ) : (
                    <span className="text-sm capitalize">{selected.status || '-'}</span>
                  )}
                </div>
                <DetailField label="Due Date" value={draft.dueDate || draft.due_date} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, dueDate: v }))} />
                <DetailField label="Notes" value={draft.notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} multiline />

                {(selected.lot_numbers && selected.lot_numbers.length > 0) && (
                  <div className="space-y-2">
                    <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lot Numbers</span>
                    <div className="overflow-hidden rounded-md border border-border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Item #</th>
                            <th className="px-3 py-2 text-left font-semibold">Description</th>
                            <th className="px-3 py-2 text-left font-semibold">Lot #</th>
                            <th className="px-3 py-2 text-right font-semibold">Qty</th>
                            <th className="px-3 py-2 text-right font-semibold">Weight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.lot_numbers.map((lot, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-3 py-2 font-mono">{lot.item_number || '-'}</td>
                              <td className="px-3 py-2">{lot.description || '-'}</td>
                              <td className="px-3 py-2 font-mono font-semibold text-amber-700">{lot.lot_number}</td>
                              <td className="px-3 py-2 text-right">{lot.qty ?? '-'}</td>
                              <td className="px-3 py-2 text-right">{lot.weight != null ? `${lot.weight} lbs` : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
          </SlideOver>
        );
      })()}
    </div>
  );
}
