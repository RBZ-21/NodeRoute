import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type Invoice = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_email?: string;
  total?: number | string;
  status?: string;
  created_at?: string;
  due_date?: string;
};

type PurchaseOrder = {
  id: string;
  total_cost?: number | string;
};

type DailyRow = {
  date: string;
  sales: number;
  invoiceCount: number;
};

type ReceivableRow = {
  customerKey: string;
  customerLabel: string;
  openBalance: number;
  openInvoiceCount: number;
  oldestIssueDate: string;
  oldestDueDate: string;
};

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function numberOr(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isOpenInvoice(status: unknown): boolean {
  return new Set(['pending', 'signed', 'sent', 'overdue']).has(normalize(status));
}

function localDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function groupByDay(invoices: Invoice[], start?: string, end?: string): DailyRow[] {
  const byDay = new Map<string, DailyRow>();
  for (const inv of invoices) {
    const key = localDateKey(inv.created_at || '');
    if (!key) continue;
    if (start && key < start) continue;
    if (end && key > end) continue;
    const current = byDay.get(key) || { date: key, sales: 0, invoiceCount: 0 };
    current.sales += numberOr(inv.total);
    current.invoiceCount += 1;
    byDay.set(key, current);
  }
  return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function summarizeReceivables(invoices: Invoice[]): ReceivableRow[] {
  const byCustomer = new Map<string, ReceivableRow>();
  for (const invoice of invoices) {
    if (!isOpenInvoice(invoice.status)) continue;
    const customerLabel = String(invoice.customer_name || invoice.customer_email || 'Unknown Customer').trim() || 'Unknown Customer';
    const customerKey = normalize(invoice.customer_email) || normalize(invoice.customer_name) || `customer:${invoice.id}`;
    const existing = byCustomer.get(customerKey) || {
      customerKey,
      customerLabel,
      openBalance: 0,
      openInvoiceCount: 0,
      oldestIssueDate: '',
      oldestDueDate: '',
    };
    existing.openBalance += numberOr(invoice.total);
    existing.openInvoiceCount += 1;
    const issueDate = localDateKey(invoice.created_at || '');
    const dueDate = localDateKey(invoice.due_date || '');
    if (issueDate && (!existing.oldestIssueDate || issueDate < existing.oldestIssueDate)) existing.oldestIssueDate = issueDate;
    if (dueDate && (!existing.oldestDueDate || dueDate < existing.oldestDueDate)) existing.oldestDueDate = dueDate;
    byCustomer.set(customerKey, existing);
  }

  return [...byCustomer.values()]
    .map((row) => ({ ...row, openBalance: numberOr(row.openBalance.toFixed(2)) }))
    .sort((a, b) => b.openBalance - a.openBalance || b.openInvoiceCount - a.openInvoiceCount || a.customerLabel.localeCompare(b.customerLabel));
}

export function FinancialsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rangeRows, setRangeRows] = useState<DailyRow[]>([]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [invoiceData, poData] = await Promise.all([
        fetchWithAuth<Invoice[]>('/api/invoices'),
        fetchWithAuth<PurchaseOrder[]>('/api/purchase-orders'),
      ]);
      setInvoices(Array.isArray(invoiceData) ? invoiceData : []);
      setPurchaseOrders(Array.isArray(poData) ? poData : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load financial data'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const today = localDateKey(new Date());
    if (!endDate) setEndDate(today);
    if (!startDate) {
      const all = groupByDay(invoices);
      setStartDate(all.length ? all[all.length - 1].date : today);
    }
  }, [invoices, startDate, endDate]);

  const todayKey = localDateKey(new Date());

  const summary = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const totalRevenue = invoices.reduce((sum, inv) => sum + numberOr(inv.total), 0);
    const monthRevenue = invoices
      .filter((inv) => {
        const d = new Date(inv.created_at || '');
        return d.getMonth() === month && d.getFullYear() === year;
      })
      .reduce((sum, inv) => sum + numberOr(inv.total), 0);
    const outstanding = invoices
      .filter((inv) => isOpenInvoice(inv.status))
      .reduce((sum, inv) => sum + numberOr(inv.total), 0);
    const cogs = purchaseOrders.reduce((sum, po) => sum + numberOr(po.total_cost), 0);
    const gross = totalRevenue - cogs;
    const daily = groupByDay(invoices, todayKey, todayKey);
    return {
      totalRevenue,
      monthRevenue,
      outstanding,
      invoices: invoices.length,
      cogs,
      marginPct: totalRevenue > 0 ? (gross / totalRevenue) * 100 : 0,
      todaySales: daily.reduce((sum, row) => sum + row.sales, 0),
      todayInvoices: daily.reduce((sum, row) => sum + row.invoiceCount, 0),
    };
  }, [invoices, purchaseOrders, todayKey]);

  const receivables = useMemo(() => summarizeReceivables(invoices), [invoices]);

  function applyRange() {
    setRangeRows(groupByDay(invoices, startDate || undefined, endDate || undefined));
  }

  function exportCsv() {
    if (!rangeRows.length) {
      alert('No rows to export for the selected date range.');
      return;
    }
    const header = ['Date', 'Sales', 'Invoices'];
    const csvRows = rangeRows.map((row) => [row.date, row.sales.toFixed(2), String(row.invoiceCount)]);
    const csv = [header, ...csvRows]
      .map((r) => r.map((value) => `"${value.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.href = href;
    a.download = `daily-sales-${startDate || 'start'}-to-${endDate || 'end'}.csv`;
    a.click();
    URL.revokeObjectURL(href);
  }

  const rangeTotal = rangeRows.reduce((sum, row) => sum + row.sales, 0);
  const rangeInvoiceCount = rangeRows.reduce((sum, row) => sum + row.invoiceCount, 0);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading financial data...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Total Revenue" value={money(summary.totalRevenue)} />
        <MetricCard title="This Month" value={money(summary.monthRevenue)} />
        <MetricCard title="Outstanding" value={money(summary.outstanding)} />
        <MetricCard title="Invoice Count" value={summary.invoices.toLocaleString()} />
        <MetricCard title="Total COGS" value={money(summary.cogs)} />
        <MetricCard title="Gross Margin" value={`${summary.marginPct.toFixed(1)}%`} />
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Accounts Receivable</CardTitle>
          <CardDescription>Running totals for customers with unpaid invoices on terms.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 text-sm text-muted-foreground">
            {receivables.length.toLocaleString()} customer account{receivables.length === 1 ? '' : 's'} with open invoices totaling{' '}
            <strong>{money(summary.outstanding)}</strong>.
          </div>
          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Open Invoices</TableHead>
                  <TableHead>Open Balance</TableHead>
                  <TableHead>Oldest Invoice</TableHead>
                  <TableHead>Oldest Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivables.length ? (
                  receivables.map((row) => (
                    <TableRow key={row.customerKey}>
                      <TableCell>{row.customerLabel}</TableCell>
                      <TableCell>{row.openInvoiceCount.toLocaleString()}</TableCell>
                      <TableCell>{money(row.openBalance)}</TableCell>
                      <TableCell>{row.oldestIssueDate ? new Date(`${row.oldestIssueDate}T00:00:00`).toLocaleDateString() : '—'}</TableCell>
                      <TableCell>{row.oldestDueDate ? new Date(`${row.oldestDueDate}T00:00:00`).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No unpaid invoices are open right now.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle>Daily Sales</CardTitle>
            <CardDescription>Current-day total plus historical date range reporting.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowHistory((value) => !value)}>
              {showHistory ? 'Hide Past Sales' : 'View Past Sales'}
            </Button>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard title="Today Sales" value={money(summary.todaySales)} subtitle={new Date().toLocaleDateString()} compact />
            <MetricCard title="Invoices Today" value={summary.todayInvoices.toLocaleString()} subtitle="Posted today" compact />
          </div>

          {showHistory ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1 text-sm font-medium text-muted-foreground">
                  Start Date
                  <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
                <label className="space-y-1 text-sm font-medium text-muted-foreground">
                  End Date
                  <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </label>
                <Button className="lg:self-end" onClick={applyRange}>
                  Apply Date Range
                </Button>
                <Button className="lg:self-end" variant="secondary" onClick={exportCsv}>
                  Export CSV
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Sales {startDate || 'Beginning'} to {endDate || 'Today'}: <strong>{money(rangeTotal)}</strong> across{' '}
                <strong>{rangeInvoiceCount.toLocaleString()}</strong> invoices and <strong>{rangeRows.length.toLocaleString()}</strong> days.
              </p>

              <div className="rounded-lg border border-border bg-card p-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Sales</TableHead>
                      <TableHead>Invoices</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rangeRows.length ? (
                      rangeRows.map((row) => (
                        <TableRow key={row.date}>
                          <TableCell>{new Date(`${row.date}T00:00:00`).toLocaleDateString()}</TableCell>
                          <TableCell>{money(row.sales)}</TableCell>
                          <TableCell>{row.invoiceCount.toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-muted-foreground">
                          No sales rows in selected range.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, subtitle, compact }: { title: string; value: string; subtitle?: string; compact?: boolean }) {
  return (
    <Card className={compact ? 'shadow-none' : ''}>
      <CardHeader className={compact ? 'space-y-1 pb-2' : 'space-y-1'}>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}
