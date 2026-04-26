import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type InvoiceStatus = 'paid' | 'pending' | 'overdue' | 'void' | 'other';

type Invoice = {
  id?: string;
  invoiceNumber?: string;
  invoice_number?: string;
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
};

type InvoicePdfResponse = {
  url?: string;
  pdfUrl?: string;
  pdf_url?: string;
};

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
  const [searchParams] = useSearchParams();
  const customerIdParam = String(searchParams.get('customerId') || '').trim();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerFilter, setCustomerFilter] = useState<'all' | string>('all');
  const [pendingActionById, setPendingActionById] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const query = customerIdParam ? `?customerId=${encodeURIComponent(customerIdParam)}` : '';
      const data = await fetchWithAuth<Invoice[]>(`/api/invoices${query}`);
      setInvoices(Array.isArray(data) ? data : []);
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
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [invoices]);

  function effectiveStatus(invoice: Invoice, index: number): InvoiceStatus {
    return normalizeStatus(invoice.status);
  }

  const filtered = useMemo(() => {
    return invoices.filter((invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (statusFilter !== 'all' && status !== statusFilter) return false;

      const invoiceCustomer = customerId(invoice);
      if (customerFilter !== 'all' && invoiceCustomer !== customerFilter) return false;

      const issue = dateKey(issueDate(invoice));
      if (startDate && (!issue || issue < startDate)) return false;
      if (endDate && (!issue || issue > endDate)) return false;

      return true;
    });
  }, [invoices, statusFilter, customerFilter, startDate, endDate]);

  const summary = useMemo(() => {
    const outstanding = invoices.reduce((sum, invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (status === 'paid' || status === 'void') return sum;
      return sum + amount(invoice);
    }, 0);

    const overdue = invoices.reduce((sum, invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (status === 'void' || status === 'paid') return sum;
      if (status === 'overdue' || isOverdueByDate(invoice)) return sum + amount(invoice);
      return sum;
    }, 0);

    const paidThisMonth = invoices.reduce((sum, invoice, index) => {
      const status = effectiveStatus(invoice, index);
      if (status !== 'paid') return sum;
      const whenPaid = paidDate(invoice) || issueDate(invoice);
      return isInCurrentMonth(whenPaid) ? sum + amount(invoice) : sum;
    }, 0);

    return { outstanding, overdue, paidThisMonth };
  }, [invoices]);

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
      const response = await fetchWithAuth<InvoicePdfResponse>(`/api/invoices/${encodeURIComponent(id)}/pdf`);
      const pdfUrl = String(response.url || response.pdfUrl || response.pdf_url || '').trim();
      if (!pdfUrl) {
        throw new Error('No PDF URL returned by invoice service');
      }
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
                      <TableCell>{invoice.orderNumber || invoice.order_number || '-'}</TableCell>
                      <TableCell>{issueDate(invoice) ? new Date(issueDate(invoice)).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{dueDate(invoice) ? new Date(dueDate(invoice)).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{asMoney(amount(invoice))}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => viewPdf(invoice, index)} disabled={!!pendingAction}>
                            View PDF
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => sendReminder(invoice, index)} disabled={!!pendingAction}>
                            Send Reminder
                          </Button>
                          <Button size="sm" onClick={() => markPaid(invoice, index)} disabled={!!pendingAction || status === 'paid' || status === 'void'}>
                            Mark Paid
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => voidInvoice(invoice, index)} disabled={!!pendingAction || status === 'void'}>
                            Void Invoice
                          </Button>
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
