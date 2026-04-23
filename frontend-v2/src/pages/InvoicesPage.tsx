import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type InvoiceStatus = 'pending' | 'signed' | 'sent' | 'unknown';

type InvoiceItem = {
  description?: string;
  quantity?: number | string;
  unit_price?: number | string;
  total?: number | string;
};

type Invoice = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_email?: string;
  billing_email?: string;
  driver_name?: string;
  total?: number | string;
  subtotal?: number | string;
  tax?: number | string;
  status?: string;
  created_at?: string;
  items?: InvoiceItem[];
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function normalizeStatus(value: string | undefined): InvoiceStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'pending' || status === 'signed' || status === 'sent') return status;
  return 'unknown';
}

function statusLabel(status: InvoiceStatus): string {
  if (status === 'pending') return 'Pending Signature';
  if (status === 'signed') return 'Signed';
  if (status === 'sent') return 'Sent';
  return 'Unknown';
}

function statusVariant(status: InvoiceStatus): 'warning' | 'secondary' | 'success' | 'neutral' {
  if (status === 'pending') return 'warning';
  if (status === 'signed') return 'secondary';
  if (status === 'sent') return 'success';
  return 'neutral';
}

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Invoice[]>('/api/invoices');
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load invoices'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const status = normalizeStatus(invoice.status);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!needle) return true;
      return (
        String(invoice.invoice_number || '').toLowerCase().includes(needle) ||
        String(invoice.customer_name || '').toLowerCase().includes(needle)
      );
    });
  }, [invoices, search, statusFilter]);

  const summary = useMemo(() => {
    const pending = invoices.filter((invoice) => normalizeStatus(invoice.status) === 'pending').length;
    const signed = invoices.filter((invoice) => normalizeStatus(invoice.status) === 'signed').length;
    const sent = invoices.filter((invoice) => normalizeStatus(invoice.status) === 'sent').length;
    const revenue = invoices.reduce((sum, invoice) => sum + asNumber(invoice.total), 0);
    return { pending, signed, sent, revenue };
  }, [invoices]);

  async function runEmailAction(invoice: Invoice, action: 'email' | 'resend') {
    const label = action === 'email' ? 'email' : 'resend';
    if (!confirm(`Confirm ${label} for invoice ${invoice.invoice_number || invoice.id.slice(0, 8)}?`)) return;

    setBusyInvoiceId(invoice.id);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/invoices/${invoice.id}/${action}`, 'POST');
      setNotice(
        action === 'email'
          ? `Invoice ${invoice.invoice_number || invoice.id.slice(0, 8)} emailed.`
          : `Invoice ${invoice.invoice_number || invoice.id.slice(0, 8)} resent.`
      );
      await load();
    } catch (err) {
      setError(String((err as Error).message || `Could not ${label} invoice`));
    } finally {
      setBusyInvoiceId(null);
    }
  }

  async function downloadPdf(invoice: Invoice) {
    setBusyInvoiceId(invoice.id);
    setError('');
    setNotice('');
    try {
      const token = localStorage.getItem('nr_token');
      const response = await fetch(`/api/invoices/${invoice.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (response.status === 401) {
        localStorage.removeItem('nr_token');
        localStorage.removeItem('nr_user');
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        let message = `Could not download invoice ${invoice.invoice_number || invoice.id.slice(0, 8)} PDF`;
        try {
          const data = (await response.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // Keep fallback message if non-JSON error body.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `invoice-${invoice.invoice_number || invoice.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
      setNotice(`PDF generated for ${invoice.invoice_number || invoice.id.slice(0, 8)}.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not download invoice PDF'));
    } finally {
      setBusyInvoiceId(null);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading invoices...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Invoices" value={invoices.length.toLocaleString()} />
        <SummaryCard label="Pending Signature" value={summary.pending.toLocaleString()} />
        <SummaryCard label="Signed" value={summary.signed.toLocaleString()} />
        <SummaryCard label="Revenue" value={money(summary.revenue)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Invoice Workbench</CardTitle>
            <CardDescription>Filter, email/resend, and export PDFs through existing `/api/invoices` routes.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Invoice # or customer" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as InvoiceStatus | 'all')}
                className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="signed">Signed</option>
                <option value="sent">Sent</option>
              </select>
            </div>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((invoice) => {
                  const status = normalizeStatus(invoice.status);
                  const canEmail = !!(invoice.billing_email || invoice.customer_email);
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoice_number || invoice.id.slice(0, 8)}</TableCell>
                      <TableCell>{invoice.customer_name || '-'}</TableCell>
                      <TableCell>{invoice.driver_name || '-'}</TableCell>
                      <TableCell>{(invoice.items || []).length.toLocaleString()}</TableCell>
                      <TableCell>{money(asNumber(invoice.total))}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
                      </TableCell>
                      <TableCell>{invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => downloadPdf(invoice)}
                            disabled={busyInvoiceId === invoice.id}
                          >
                            PDF
                          </Button>
                          {canEmail ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => runEmailAction(invoice, 'email')}
                              disabled={busyInvoiceId === invoice.id}
                            >
                              Email
                            </Button>
                          ) : null}
                          {canEmail ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => runEmailAction(invoice, 'resend')}
                              disabled={busyInvoiceId === invoice.id}
                            >
                              Resend
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
                    No invoices match the current filters.
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
