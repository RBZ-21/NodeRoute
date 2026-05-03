import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { clearSession, fetchWithAuth, redirectToLogin, sendWithAuth } from '../lib/api';
import type { Order as PendingWeightOrder } from './orders.types';
import { calcOrderTotal, hasPendingWeight } from './orders.types';

type InvoiceStatus = 'paid' | 'pending' | 'overdue' | 'void' | 'other';

type Invoice = {
  id?: string;
  invoiceNumber?: string;
  invoice_number?: string;
  order_id?: string;
  customer?: string;
  customerName?: string;
  customer_name?: string;
  customerId?: string;
  customer_id?: string;
  orderNumber?: string;
  order_number?: string;
  issueDate?: string;
  issue_date?: string;
  dueDate?: string;
  due_date?: string;
  paidDate?: string;
  paid_date?: string;
  amount?: number | string;
  total?: number | string;
  status?: string;
  pdfUrl?: string;
  pdf_url?: string;
  estimated_weight_pending?: boolean;
  source?: 'invoice' | 'order-draft';
};

type OrderDraft = PendingWeightOrder;

const statusColors = {
  paid: 'green',
  pending: 'yellow',
  overdue: 'red',
  void: 'gray',
} as const;

function normalizeStatus(value: string | undefined): InvoiceStatus {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'paid') return 'paid';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'overdue') return 'overdue';
  if (normalized === 'void') return 'void';
  return 'other';
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function dateKey(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isInCurrentMonth(value: string | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function invoiceId(invoice: Invoice, index: number): string {
  return String(invoice.id || invoice.invoiceNumber || invoice.invoice_number || `INV-${index + 1}`);
}

function invoiceNumber(invoice: Invoice, index: number): string {
  return String(invoice.invoiceNumber || invoice.invoice_number || invoice.id || `INV-${index + 1}`);
}

function invoiceApiId(invoice: Invoice, index: number): string {
  return String(invoice.id || invoice.invoiceNumber || invoice.invoice_number || `INV-${index + 1}`);
}

function customerName(invoice: Invoice): string {
  return String(invoice.customer || invoice.customerName || invoice.customer_name || '-');
}

function customerId(invoice: Invoice): string {
  return String(invoice.customerId || invoice.customer_id || '');
}

function amount(invoice: Invoice): number {
  return toNumber(invoice.amount ?? invoice.total);
}

function issueDate(invoice: Invoice): string {
  return String(invoice.issueDate || invoice.issue_date || '');
}

function dueDate(invoice: Invoice): string {
  return String(invoice.dueDate || invoice.due_date || '');
}

function paidDate(invoice: Invoice): string {
  return String(invoice.paidDate || invoice.paid_date || '');
}

function isOverdueByDate(invoice: Invoice): boolean {
  const due = dueDate(invoice);
  if (!due) return false;
  const dueKey = dateKey(due);
  const todayKey = dateKey(new Date().toISOString());
  return !!dueKey && dueKey < todayKey;
}

export function InvoicesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const customerIdParam = String(searchParams.get('customerId') || '').trim();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [ordersAwaitingWeights, setOrdersAwaitingWeights] = useState<OrderDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerFilter, setCustomerFilter] = useState<'all' | string>('all');
  const [pendingActionById, setPendingActionById] = useState<Record<string, string>>({});

  // AI: Invoice follow-up drafts
  type FollowUpDraft = { invoice_id: string; days_overdue: number; subject: string; body: string; tone: string; key_points: string[] };
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState<Record<string, boolean>>({});

  async function generateFollowUp(invoiceId: string) {
    setFollowUpLoading((prev) => ({ ...prev, [invoiceId]: true }));
    try {
      const result = await sendWithAuth<FollowUpDraft>('/api/ai/invoice-followup', 'POST', { invoice_id: invoiceId });
      setFollowUpDraft(result);
    } catch (err) {
      setError(String((err as Error).message || 'Follow-up generation failed'));
    } finally {
      setFollowUpLoading((prev) => ({ ...prev, [invoiceId]: false }));
    }
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const query = customerIdParam ? `?customerId=${encodeURIComponent(customerIdParam)}` : '';
      const [invoiceData, orderData] = await Promise.all([
        fetchWithAuth<Invoice[]>(`/api/invoices${query}`),
        fetchWithAuth<OrderDraft[]>('/api/orders'),
      ]);
      setInvoices(Array.isArray(invoiceData) ? invoiceData : []);
      setOrdersAwaitingWeights(Array.isArray(orderData) ? orderData : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load invoices'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [customerIdParam]);

  useEffect(() => {
    setCustomerFilter(customerIdParam || 'all');
  }, [customerIdParam]);

  const customerOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const invoice of invoices) {
      const id = customerId(invoice);
      if (id) unique.add(id);
    }
    for (const order of ordersAwaitingWeights) {
      const id = String(order.customer_id || '').trim();
      if (id) unique.add(id);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [invoices, ordersAwaitingWeights]);

  const syntheticInvoices = useMemo(() => {
    const persistedOrderIds = new Set(
      invoices
        .map((invoice) => String(invoice.order_id || '').trim())
        .filter(Boolean),
    );

    return ordersAwaitingWeights
      .filter((order) => {
        if (persistedOrderIds.has(order.id)) return false;
        return (order.items || []).some((item) => hasPendingWeight(item));
      })
      .map<Invoice>((order) => ({
        id: `draft-${order.id}`,
        order_id: order.id,
        invoice_number: `DRAFT-${order.order_number || order.id.slice(0, 8)}`,
        customer_name: order.customer_name || '',
        customer_id: order.customer_id || '',
        order_number: order.order_number || '',
        issue_date: order.created_at || '',
        amount: calcOrderTotal(order),
        total: calcOrderTotal(order),
        status: 'pending',
        estimated_weight_pending: true,
        source: 'order-draft',
      }));
  }, [invoices, ordersAwaitingWeights]);

  const visibleInvoices = useMemo(
    () => [...syntheticInvoices, ...invoices.map((invoice) => ({ ...invoice, source: invoice.source || 'invoice' as const }))],
    [syntheticInvoices, invoices],
  );

  function effectiveStatus(invoice: Invoice, index: number): InvoiceStatus {
    return normalizeStatus(invoice.status);
  }

  const filtered = useMemo(() => {
    return visibleInvoices.filter((invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (statusFilter !== 'all' && status !== statusFilter) return false;

      const invoiceCustomer = customerId(invoice);
      if (customerFilter !== 'all' && invoiceCustomer !== customerFilter) return false;

      const issue = dateKey(issueDate(invoice));
      if (startDate && (!issue || issue < startDate)) return false;
      if (endDate && (!issue || issue > endDate)) return false;

      return true;
    });
  }, [visibleInvoices, statusFilter, customerFilter, startDate, endDate]);

  const summary = useMemo(() => {
    const outstanding = visibleInvoices.reduce((sum, invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (status === 'paid' || status === 'void') return sum;
      return sum + amount(invoice);
    }, 0);

    const overdue = visibleInvoices.reduce((sum, invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (status === 'void' || status === 'paid') return sum;
      if (status === 'overdue' || isOverdueByDate(invoice)) return sum + amount(invoice);
      return sum;
    }, 0);

    const paidThisMonth = visibleInvoices.reduce((sum, invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (status !== 'paid') return sum;
      const whenPaid = paidDate(invoice) || issueDate(invoice);
      return isInCurrentMonth(whenPaid) ? sum + amount(invoice) : sum;
    }, 0);

    return { outstanding, overdue, paidThisMonth };
  }, [visibleInvoices]);

  function setActionPending(id: string, action: string | null) {
    setPendingActionById((current) => {
      if (!action) {
        const { [id]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: action };
    });
  }

  function updateInvoiceStatusInState(id: string, status: 'paid' | 'void') {
    setInvoices((current) =>
      current.map((invoice, index) => {
        if (invoiceApiId(invoice, index) !== id) return invoice;
        return {
          ...invoice,
          status,
          paidDate: status === 'paid' ? new Date().toISOString() : invoice.paidDate,
          paid_date: status === 'paid' ? new Date().toISOString() : invoice.paid_date,
        };
      })
    );
  }

  async function sendReminder(invoice: Invoice, index: number) {
    const id = invoiceApiId(invoice, index);
    setError('');
    setNotice('');
    setActionPending(id, 'remind');
    try {
      await sendWithAuth(`/api/invoices/${encodeURIComponent(id)}/remind`, 'POST');
      setNotice(`Reminder sent for invoice ${invoiceNumber(invoice, index)}.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not send invoice reminder'));
    } finally {
      setActionPending(id, null);
    }
  }

  async function markPaid(invoice: Invoice, index: number) {
    const id = invoiceApiId(invoice, index);
    setError('');
    setNotice('');
    setActionPending(id, 'paid');
    try {
      await sendWithAuth(`/api/invoices/${encodeURIComponent(id)}`, 'PATCH', { status: 'paid' });
      updateInvoiceStatusInState(id, 'paid');
      setNotice(`Invoice ${invoiceNumber(invoice, index)} marked as paid.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not mark invoice as paid'));
    } finally {
      setActionPending(id, null);
    }
  }

  async function voidInvoice(invoice: Invoice, index: number) {
    if (!confirm(`Void invoice ${invoiceNumber(invoice, index)}?`)) return;
    const id = invoiceApiId(invoice, index);
    setError('');
    setNotice('');
    setActionPending(id, 'void');
    try {
      await sendWithAuth(`/api/invoices/${encodeURIComponent(id)}`, 'PATCH', { status: 'void' });
      updateInvoiceStatusInState(id, 'void');
      setNotice(`Invoice ${invoiceNumber(invoice, index)} marked as void.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not void invoice'));
    } finally {
      setActionPending(id, null);
    }
  }

  async function viewPdf(invoice: Invoice, index: number) {
    const id = invoiceApiId(invoice, index);
    setError('');
    setNotice('');
    setActionPending(id, 'pdf');
    try {
      const token = localStorage.getItem('nr_token');
      const response = await fetch(`/api/invoices/${encodeURIComponent(id)}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.status === 401) {
        clearSession();
        redirectToLogin('Your session could not be verified. Please sign in again.');
        throw new Error('Unauthorized');
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(String(payload?.error || 'Could not open invoice PDF'));
      }
      const pdfBlob = await response.blob();
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      setNotice(`Opened PDF for invoice ${invoiceNumber(invoice, index)}.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not open invoice PDF'));
    } finally {
      setActionPending(id, null);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading invoices...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      {/* AI Follow-Up Draft Modal */}
      {followUpDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold">AI Follow-Up Draft</h2>
                <p className="text-xs text-muted-foreground capitalize">{followUpDraft.days_overdue} days overdue · tone: <span className={`font-medium ${followUpDraft.tone === 'urgent' ? 'text-red-600' : followUpDraft.tone === 'firm' ? 'text-yellow-600' : 'text-emerald-600'}`}>{followUpDraft.tone}</span></p>
              </div>
              <button onClick={() => setFollowUpDraft(null)} className="rounded p-1 hover:bg-muted text-muted-foreground">✕</button>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject</p>
                <p className="rounded border border-border bg-muted/30 px-3 py-2 text-sm">{followUpDraft.subject}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Body</p>
                <pre className="whitespace-pre-wrap rounded border border-border bg-muted/30 px-3 py-2 text-sm font-sans">{followUpDraft.body}</pre>
              </div>
              {followUpDraft.key_points.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">AR Notes</p>
                  <ul className="space-y-0.5">{followUpDraft.key_points.map((k, i) => <li key={i} className="text-xs text-muted-foreground">• {k}</li>)}</ul>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => { void navigator.clipboard.writeText(`Subject: ${followUpDraft.subject}\n\n${followUpDraft.body}`); setNotice('Copied to clipboard.'); setFollowUpDraft(null); }} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Copy & Close</button>
              <button onClick={() => setFollowUpDraft(null)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">Dismiss</button>
            </div>
          </div>
        </div>
      )}
      {customerIdParam ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Filtered by customer from Customers page: <strong>{customerIdParam}</strong>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Total Outstanding" value={asMoney(summary.outstanding)} />
        <SummaryCard label="Total Overdue" value={asMoney(summary.overdue)} />
        <SummaryCard label="Paid This Month" value={asMoney(summary.paidThisMonth)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Invoices Workbench</CardTitle>
            <CardDescription>Billing queue and collection controls from `/api/invoices`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | InvoiceStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="overdue">Overdue</option>
                <option value="void">Void</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start Date</span>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">End Date</span>
              <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</span>
              <select
                value={customerFilter}
                onChange={(event) => setCustomerFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Customers</option>
                {customerOptions.map((customer) => (
                  <option key={customer} value={customer}>
                    {customer}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((invoice, index) => {
                  const id = invoiceId(invoice, index);
                  const apiId = invoiceApiId(invoice, index);
                  const status = effectiveStatus(invoice, index);
                  const pendingAction = pendingActionById[apiId];
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">
                        <div className="space-y-0.5">
                          <span>{invoiceNumber(invoice, index)}</span>
                          {invoice.estimated_weight_pending && (
                            <div className="text-xs font-medium text-amber-600">⚠️ Weight Pending</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{customerName(invoice)}</TableCell>
                      <TableCell>
                        {invoice.orderNumber || invoice.order_number ? (
                          <button
                            className="font-medium text-primary underline-offset-2 hover:underline"
                            onClick={() => {
                              const cid = customerId(invoice);
                              navigate(cid ? `/orders?customerId=${encodeURIComponent(cid)}` : '/orders');
                            }}
                          >
                            {invoice.orderNumber || invoice.order_number}
                          </button>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>{issueDate(invoice) ? new Date(issueDate(invoice)).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{dueDate(invoice) ? new Date(dueDate(invoice)).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{asMoney(amount(invoice))}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {invoice.source === 'order-draft' ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/orders?orderId=${encodeURIComponent(String(invoice.order_id || ''))}&action=weights`)}
                            >
                              Enter Weights
                            </Button>
                          ) : null}
                          {invoice.source !== 'order-draft' ? (
                          <Button variant="ghost" size="sm" onClick={() => viewPdf(invoice, index)} disabled={!!pendingAction}>
                            View PDF
                          </Button>
                          ) : null}
                          {invoice.source !== 'order-draft' ? (
                          <Button variant="secondary" size="sm" onClick={() => sendReminder(invoice, index)} disabled={!!pendingAction}>
                            Send Reminder
                          </Button>
                          ) : null}
                          {invoice.source !== 'order-draft' ? (
                          <Button size="sm" onClick={() => markPaid(invoice, index)} disabled={!!pendingAction || status === 'paid' || status === 'void'}>
                            Mark Paid
                          </Button>
                          ) : null}
                          {invoice.source !== 'order-draft' && invoice.id ? (
                          <Button variant="ghost" size="sm" onClick={() => void generateFollowUp(invoice.id!)} disabled={!!followUpLoading[invoice.id!] || status === 'paid' || status === 'void'} title="AI follow-up draft">
                            {followUpLoading[invoice.id!] ? '…' : '✦ Draft Follow-Up'}
                          </Button>
                          ) : null}
                          {invoice.source !== 'order-draft' ? (
                          <Button variant="ghost" size="sm" onClick={() => voidInvoice(invoice, index)} disabled={!!pendingAction || status === 'void'}>
                            Void Invoice
                          </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No invoices found for the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
