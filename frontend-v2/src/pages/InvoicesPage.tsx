import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type Invoice, type InvoiceLotEntry, useDeleteInvoice, useInvoices, useResendInvoiceEmail, useUpdateInvoice } from '../hooks/useInvoices';
import { type InvoiceFollowUpResult, useInvoiceFollowUp, useLatePaymentRisk } from '../hooks/useAI';
import { ChevronDown, ChevronRight } from 'lucide-react';

type InvoiceStatus = 'pending' | 'sent' | 'delivered' | 'paid' | 'overdue' | 'void' | 'other';

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
  const { data: invoices = [], isLoading, isError, error, refetch } = useInvoices();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const resendInvoiceEmail = useResendInvoiceEmail();
  const latePaymentRisk = useLatePaymentRisk(true);
  const invoiceFollowUp = useInvoiceFollowUp();

  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
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

  const topRisks = useMemo(() => (latePaymentRisk.data?.risks || []).slice(0, 3), [latePaymentRisk.data]);
  const selectedRisk = selected ? riskByCustomer.get(customerName(selected).toLowerCase()) : undefined;

  useEffect(() => {
    if (!selected) {
      setFollowUpDraft(null);
      setFollowUpInvoiceId(null);
      setFollowUpError('');
      return;
    }
    const selectedId = String(selected.id || '');
    if (!selectedId || !shouldSuggestFollowUp(selected)) return;
    if (invoiceFollowUp.isPending) return;
    if (followUpInvoiceId === selectedId && followUpDraft) return;

    setFollowUpError('');
    invoiceFollowUp.mutate(selectedId, {
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
  }, [followUpDraft, followUpInvoiceId, invoiceFollowUp.isPending, invoiceFollowUp.mutate, selected]);

  function openInvoice(inv: Invoice) {
    setSelected(inv);
    setDraft({ ...inv });
    setEditing(false);
    setConfirmDelete(false);
    setFollowUpError('');
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
        setNotice(`Invoice ${invoiceId(selected!)} deleted.`);
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
          setNotice(`Invoice ${invoiceId(selected!)} saved.`);
        },
      }
    );
  }

  function resendInvoice(inv: Invoice) {
    const id = inv.id;
    if (!id) return;
    resendInvoiceEmail.mutate(id, {
      onSuccess: () => {
        setActionError('');
        setNotice(`Invoice ${invoiceId(inv)} emailed.`);
      },
      onError: (mutationError) => {
        setNotice('');
        setActionError(String((mutationError as Error)?.message || 'Could not resend invoice email'));
      },
    });
  }

  function markInvoicePaid(inv: Invoice) {
    const id = inv.id;
    if (!id || normalizeStatus(inv.status) === 'paid') return;
    const idString = String(id);
    setActionError('');
    setMarkingPaidInvoiceId(idString);
    updateInvoice.mutate(
      { id, patch: { status: 'paid' } },
      {
        onSuccess: (updated) => {
          const paidInvoice = { ...inv, ...(updated as Partial<Invoice>), status: 'paid' };
          if (selected && String(selected.id || '') === idString) {
            setSelected({ ...selected, ...paidInvoice });
            setDraft((current) => ({ ...current, ...paidInvoice }));
          }
          setNotice(`Invoice ${invoiceId(inv)} marked paid.`);
        },
        onError: (mutationError) => {
          setActionError(String((mutationError as Error)?.message || 'Could not mark invoice paid'));
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
    const idString = String(id);
    setActionError('');
    setMarkingDeliveredInvoiceId(idString);
    updateInvoice.mutate(
      { id, patch: { status: 'delivered' } },
      {
        onSuccess: (updated) => {
          const deliveredInvoice = { ...inv, ...(updated as Partial<Invoice>), status: 'delivered' };
          if (selected && String(selected.id || '') === idString) {
            setSelected({ ...selected, ...deliveredInvoice });
            setDraft((current) => ({ ...current, ...deliveredInvoice }));
          }
          setNotice(`Invoice ${invoiceId(inv)} marked delivered.`);
        },
        onError: (mutationError) => {
          setActionError(String((mutationError as Error)?.message || 'Could not mark invoice delivered'));
        },
        onSettled: () => {
          setMarkingDeliveredInvoiceId(null);
        },
      }
    );
  }

  function generateFollowUpForInvoice(inv: Invoice) {
    const id = String(inv.id || '');
    if (!id) return;
    setFollowUpError('');
    setFollowUpDraft(null);
    setFollowUpInvoiceId(id);
    openInvoice(inv);
    invoiceFollowUp.mutate(id, {
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
      setNotice(selected ? `AI follow-up copied for invoice ${invoiceId(selected)}.` : 'AI follow-up copied.');
    } catch {
      setActionError('Could not copy follow-up to clipboard');
    }
  }

  function renderInvoiceRows(rows: Invoice[], emptyMessage: string) {
    return rows.length ? rows.map((inv) => {
      const status = normalizeStatus(inv.status);
      const isDelivered = status === 'delivered';
      const isPaid = status === 'paid';
      const risk = riskByCustomer.get(customerName(inv).toLowerCase());
      return (
        <TableRow key={invoiceId(inv)}>
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
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className={`whitespace-nowrap${isDelivered ? ' border-green-500 bg-green-50 text-green-700 hover:bg-green-100' : ''}`}
                disabled={isDelivered || isPaid || (updateInvoice.isPending && markingDeliveredInvoiceId === String(inv.id || ''))}
                onClick={() => markInvoiceDelivered(inv)}
              >
                {updateInvoice.isPending && markingDeliveredInvoiceId === String(inv.id || '') ? 'Saving...' : 'Delivered'}
              </Button>
              <Button
                size="sm"
                variant={isPaid ? 'outline' : 'default'}
                className="whitespace-nowrap"
                disabled={isPaid || (updateInvoice.isPending && markingPaidInvoiceId === String(inv.id || ''))}
                onClick={() => markInvoicePaid(inv)}
              >
                {updateInvoice.isPending && markingPaidInvoiceId === String(inv.id || '') ? 'Saving...' : 'PAID'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="whitespace-nowrap"
                disabled={resendInvoiceEmail.isPending}
                onClick={() => resendInvoice(inv)}
              >
                {resendInvoiceEmail.isPending ? 'Sending...' : 'Resend Email'}
              </Button>
              {shouldSuggestFollowUp(inv) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="whitespace-nowrap"
                  disabled={invoiceFollowUp.isPending && followUpInvoiceId === String(inv.id || '')}
                  onClick={() => generateFollowUpForInvoice(inv)}
                >
                  {invoiceFollowUp.isPending && followUpInvoiceId === String(inv.id || '') ? 'Drafting...' : 'AI Follow-Up'}
                </Button>
              ) : null}
              <Button size="sm" className="whitespace-nowrap" onClick={() => openInvoice(inv)}>View / Edit</Button>
            </div>
          </TableCell>
        </TableRow>
      );
    }) : (
      <TableRow><TableCell colSpan={11} className="text-muted-foreground">{emptyMessage}</TableCell></TableRow>
    );
  }

  function invoiceTable(rows: Invoice[], emptyMessage: string) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
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
          <TableBody>{renderInvoiceRows(rows, emptyMessage)}</TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading invoices...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load invoices')}</div> : null}
      {actionError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{actionError}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total" value={summary.total.toLocaleString()} />
        <SummaryCard label="Paid" value={summary.paid.toLocaleString()} />
        <SummaryCard label="Overdue" value={summary.overdue.toLocaleString()} />
        <SummaryCard label="Outstanding" value={summary.outstanding.toLocaleString()} />
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
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | InvoiceStatus)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="void">Voided</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input placeholder="Invoice #, customer, lot #..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-52" />
            </label>
            <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          {invoiceTable(activeInvoicesForDay, 'No active invoices found for this day.')}
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
            {invoiceTable(deliveredInvoices, 'No delivered invoices match the current filters.')}
          </CardContent>
        ) : null}
      </Card>

      {selected && (() => {
        const selStatus = normalizeStatus(selected.status);
        const selDelivered = selStatus === 'delivered';
        const selPaid = selStatus === 'paid';
        return (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} />
            <div className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-background shadow-xl">
              <div className="flex items-center justify-between border-b px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold">{invoiceId(selected)}</h2>
                  <p className="text-sm text-muted-foreground">{customerName(selected)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
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
                          setNotice(`Invoice ${invoiceId(selected)} cannot be printed until final weights are entered.`);
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
                      disabled={invoiceFollowUp.isPending && followUpInvoiceId === String(selected.id || '')}
                      onClick={() => generateFollowUpForInvoice(selected)}
                    >
                      {invoiceFollowUp.isPending && followUpInvoiceId === String(selected.id || '') ? 'Drafting...' : 'Refresh AI Draft'}
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
                  <Button size="sm" variant="ghost" onClick={() => { setSelected(null); setConfirmDelete(false); }}>X</Button>
                </div>
              </div>
              <div className="flex-1 space-y-4 p-6">
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
                          disabled={invoiceFollowUp.isPending && followUpInvoiceId === String(selected.id || '')}
                          onClick={() => generateFollowUpForInvoice(selected)}
                        >
                          {invoiceFollowUp.isPending && followUpInvoiceId === String(selected.id || '') ? 'Drafting...' : 'Regenerate'}
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
                          {invoiceFollowUp.isPending && followUpInvoiceId === String(selected.id || '') ? 'Generating follow-up draft...' : 'Open an overdue invoice to generate a follow-up.'}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : null}

                <InvoiceField label="Invoice #" value={draft.invoiceNumber || draft.invoice_number} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, invoiceNumber: v }))} />
                <InvoiceField label="Customer" value={draft.customerName || draft.customer_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, customerName: v }))} />
                <div className="flex items-start gap-3">
                  <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Order Date</span>
                  <span className="text-sm">{formatDate(selected.created_at || selected.issuedDate || selected.issued_date)}</span>
                </div>
                <InvoiceField label="Amount" value={String(draft.amount ?? '')} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
                <div className="flex items-start gap-3">
                  <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                  {editing ? (
                    <select value={draft.status || ''} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm">
                      <option value="pending">Pending</option>
                      <option value="sent">Sent</option>
                      <option value="delivered">Delivered</option>
                      <option value="paid">Paid</option>
                      <option value="overdue">Overdue</option>
                      <option value="void">Voided</option>
                    </select>
                  ) : (
                    <span className="text-sm capitalize">{selected.status || '-'}</span>
                  )}
                </div>
                <InvoiceField label="Due Date" value={draft.dueDate || draft.due_date} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, dueDate: v }))} />
                <InvoiceField label="Notes" value={draft.notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} multiline />

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
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function InvoiceField({ label, value, editing, onChange, multiline }: { label: string; value?: string | null; editing: boolean; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">{label}</span>
      {editing ? (
        multiline ? (
          <textarea className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input className="flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        )
      ) : (
        <span className="text-sm">{value || '-'}</span>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>
  );
}
