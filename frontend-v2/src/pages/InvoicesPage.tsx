import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatCard } from '../components/ui/stat-card';
import { useToast } from '../components/ui/toast';
import { Input } from '../components/ui/input';
import { SelectInput } from '../components/ui/select-input';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { StatusBadge } from '../components/ui/status-badge';
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
import { printInvoiceSummary as printInvoiceSummaryPopup } from '../lib/invoicePrint';
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer';
import { InvoiceTable } from './InvoiceTable';

type InvoiceStatus = 'pending' | 'sent' | 'delivered' | 'paid' | 'overdue' | 'void' | 'other';
type InvoiceBulkStatus = Exclude<InvoiceStatus, 'other'>;

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
    const merged = { ...invoice, ...draft };
    const lots = merged.lot_numbers || [];
    printInvoiceSummaryPopup({
      invoiceId: invoiceId(merged),
      customerName: customerName(merged),
      orderId: String(merged.orderId || merged.order_id || ''),
      status: String(merged.status || 'draft'),
      amount: formatAmount(merged.amount),
      issuedDate: formatDate(merged.issuedDate || merged.issued_date),
      dueDate: formatDate(merged.dueDate || merged.due_date),
      notes: merged.notes || '',
      lots,
      totalQty: totalLotQuantity(lots),
      totalWeight: totalLotWeight(lots),
    });
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

  const commonInvoiceTableProps = {
    riskByCustomer,
    selectedInvoiceIds,
    onToggleInvoiceSelected: toggleInvoiceSelected,
    bulkUpdatingInvoices,
    allVisibleInvoicesSelected,
    onToggleAllVisibleInvoices: toggleAllVisibleInvoices,
    selectedVisibleCount: selectedVisibleInvoiceIds.length,
    activeInvoiceCount: activeInvoiceIds.length,
    bulkInvoiceStatus,
    onBulkInvoiceStatusChange: setBulkInvoiceStatus,
    onApplyBulkInvoiceStatus: () => void applyBulkInvoiceStatus(),
    updateInvoicePending: updateInvoice.isPending,
    markingDeliveredInvoiceId,
    markingPaidInvoiceId,
    resendInvoiceEmailPending: resendInvoiceEmail.isPending,
    invoiceFollowUpPending,
    followUpInvoiceId,
    onOpenInvoice: openInvoice,
    onMarkDelivered: markInvoiceDelivered,
    onMarkPaid: markInvoicePaid,
    onResend: resendInvoice,
    onGenerateFollowUp: generateFollowUpForInvoice,
    onCreateOrder: () => navigate('/orders'),
    invoiceId,
    customerName,
    formatAmount,
    formatDate,
    lotSummary,
    normalizeStatus,
    invoiceActivityDate,
    shouldSuggestFollowUp,
  };

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
          <InvoiceTable
            {...commonInvoiceTableProps}
            rows={activeInvoicePagination.pageItems}
            emptyMessage="No active invoices found for this day."
            selectable
            pagination={activeInvoicePagination}
            onPageSizeChange={setActiveInvoicePageSize}
          />
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
            <InvoiceTable
              {...commonInvoiceTableProps}
              rows={deliveredInvoicePagination.pageItems}
              emptyMessage="No delivered invoices match the current filters."
              pagination={deliveredInvoicePagination}
              onPageSizeChange={setDeliveredInvoicePageSize}
            />
          </CardContent>
        ) : null}
      </Card>

      {selected && (
        <InvoiceDetailDrawer
          selected={selected}
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          setEditing={setEditing}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          selectedRisk={selectedRisk}
          followUpDraft={followUpDraft}
          followUpInvoiceId={followUpInvoiceId}
          followUpError={followUpError}
          followUpPending={invoiceFollowUpPending}
          addonDraft={addonDraft}
          setAddonDraft={setAddonDraft}
          returnDraft={returnDraft}
          setReturnDraft={setReturnDraft}
          updateInvoice={updateInvoice}
          deleteInvoice={deleteInvoice}
          resendInvoiceEmail={resendInvoiceEmail}
          addInvoiceAddon={addInvoiceAddon}
          createInvoiceReturn={createInvoiceReturn}
          markingDeliveredInvoiceId={markingDeliveredInvoiceId}
          markingPaidInvoiceId={markingPaidInvoiceId}
          invoiceId={invoiceId}
          customerName={customerName}
          formatAmount={formatAmount}
          formatDate={formatDate}
          totalLotQuantity={totalLotQuantity}
          totalLotWeight={totalLotWeight}
          invoicePrintBlocked={invoicePrintBlocked}
          shouldSuggestFollowUp={shouldSuggestFollowUp}
          daysPastDue={daysPastDue}
          toneLabel={toneLabel}
          onClose={() => { setSelected(null); setConfirmDelete(false); }}
          onMarkDelivered={markInvoiceDelivered}
          onMarkPaid={markInvoicePaid}
          onPrint={(invoice) => {
            if (invoicePrintBlocked(invoice)) {
              toast.success(`Invoice ${invoiceId(invoice)} cannot be printed until final weights are entered.`);
              return;
            }
            printInvoiceSummary(invoice);
          }}
          onResend={resendInvoice}
          onGenerateFollowUp={generateFollowUpForInvoice}
          onSave={saveInvoice}
          onDelete={handleDelete}
          onSubmitAddon={submitAddon}
          onSubmitReturnCredit={submitReturnCredit}
          onCopyFollowUp={copyFollowUp}
        />
      )}
    </div>
  );
}
