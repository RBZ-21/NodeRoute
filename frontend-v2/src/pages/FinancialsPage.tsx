import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import {
  type FinancialInvoice,
  useFinancePOsQuery,
  useFinancialInvoicesQuery,
} from '../hooks/useFinancials';

type FinancialTab = 'inquiry' | 'receipts' | 'aging' | 'finance' | 'tax' | 'journals';

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

type AccountInquiry = {
  customer?: { company_name?: string; credit_status?: string; current_balance?: number };
  open_invoices: Array<{ id: string; invoice_number?: string; due_date?: string; open_balance?: number; total?: number; days_past_due?: number; status?: string }>;
  unapplied_cash: number;
  aging_buckets: Record<string, number>;
  credit_status: string;
  payment_methods: string[];
  recent_activity: Array<{ id: string; entry_type: string; amount: number; balance_after: number; entry_date: string; reference_type?: string }>;
};

type AgingReport = {
  as_of_date: string;
  rows: Array<{ customer_id: string; customer_name: string; invoice_count: number; total_open: number; buckets: Record<string, number> }>;
};

type CashReceipt = {
  id: string;
  customer_id: string;
  receipt_date: string;
  total_amount: number;
  unapplied_amount?: number;
  payment_method: string;
  check_number?: string | null;
  status: string;
};

type FinanceChargeResult = {
  mode: string;
  run_date?: string;
  total_charges: number;
  idempotent?: boolean;
  entries: Array<{ customer_id: string; invoice_id: string; days_overdue: number; charge_amount: number }>;
};

const tabs: Array<{ id: FinancialTab; label: string }> = [
  { id: 'inquiry', label: 'Account Inquiry' },
  { id: 'receipts', label: 'Cash Receipts' },
  { id: 'aging', label: 'Aging Report' },
  { id: 'finance', label: 'Finance Charges' },
  { id: 'tax', label: 'Tax' },
  { id: 'journals', label: 'Journals' },
];

function money(value: unknown): string {
  const parsed = Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function numberOr(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isOpenInvoice(status: unknown): boolean {
  return new Set(['pending', 'signed', 'sent', 'delivered', 'overdue', 'open']).has(normalize(status));
}

function localDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function groupByDay(invoices: FinancialInvoice[], start?: string, end?: string): DailyRow[] {
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

function summarizeReceivables(invoices: FinancialInvoice[]): ReceivableRow[] {
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
  const queryClient = useQueryClient();
  const invoicesQuery = useFinancialInvoicesQuery();
  const posQuery = useFinancePOsQuery();

  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);
  const purchaseOrders = useMemo(() => posQuery.data ?? [], [posQuery.data]);
  const [activeTab, setActiveTab] = useState<FinancialTab>('inquiry');

  const [showHistory, setShowHistory] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rangeRows, setRangeRows] = useState<DailyRow[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [inquiry, setInquiry] = useState<AccountInquiry | null>(null);
  const [inquiryError, setInquiryError] = useState('');
  const [inquiryLoading, setInquiryLoading] = useState(false);

  const [receiptCustomerId, setReceiptCustomerId] = useState('');
  const [receiptInvoiceId, setReceiptInvoiceId] = useState('');
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptAppliedAmount, setReceiptAppliedAmount] = useState('');
  const [receiptMethod, setReceiptMethod] = useState('check');
  const [receiptCheckNumber, setReceiptCheckNumber] = useState('');
  const [receiptResult, setReceiptResult] = useState<CashReceipt | null>(null);
  const [receiptError, setReceiptError] = useState('');

  const [agingDate, setAgingDate] = useState(localDateKey(new Date()));
  const [agingReport, setAgingReport] = useState<AgingReport | null>(null);
  const [agingError, setAgingError] = useState('');

  const [financeRunDate, setFinanceRunDate] = useState(localDateKey(new Date()));
  const [financeResult, setFinanceResult] = useState<FinanceChargeResult | null>(null);
  const [financeError, setFinanceError] = useState('');

  const [journalFrom, setJournalFrom] = useState('');
  const [journalTo, setJournalTo] = useState(localDateKey(new Date()));
  const [journalRows, setJournalRows] = useState<CashReceipt[]>([]);
  const [journalError, setJournalError] = useState('');

  useEffect(() => {
    const today = localDateKey(new Date());
    setEndDate((current) => current || today);
    setStartDate((current) => {
      if (current) return current;
      const all = groupByDay(invoices);
      return all.length ? all[all.length - 1].date : today;
    });
  }, [invoices]);

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
    const outstanding = invoices.filter((inv) => isOpenInvoice(inv.status)).reduce((sum, inv) => sum + numberOr(inv.total), 0);
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

  const taxSummary = useMemo(() => {
    const taxable = invoices.reduce((sum, inv) => sum + numberOr((inv as FinancialInvoice & { subtotal?: unknown }).subtotal ?? inv.total), 0);
    const tax = invoices.reduce((sum, inv) => sum + numberOr((inv as FinancialInvoice & { tax?: unknown }).tax), 0);
    return { taxable, tax, effectiveRate: taxable > 0 ? (tax / taxable) * 100 : 0 };
  }, [invoices]);
  const receivables = useMemo(() => summarizeReceivables(invoices), [invoices]);

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ['financial-invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['finance-purchase-orders'] });
  }

  function applyRange() {
    setRangeRows(groupByDay(invoices, startDate || undefined, endDate || undefined));
  }

  async function loadInquiry() {
    if (!customerId.trim()) return;
    setInquiryLoading(true);
    setInquiryError('');
    try {
      setInquiry(await fetchWithAuth<AccountInquiry>(`/api/ar/account-inquiry/${encodeURIComponent(customerId.trim())}`));
    } catch (error) {
      setInquiryError((error as Error).message || 'Could not load account inquiry');
    } finally {
      setInquiryLoading(false);
    }
  }

  async function saveReceipt() {
    setReceiptError('');
    setReceiptResult(null);
    try {
      const total = numberOr(receiptAmount);
      const applied = numberOr(receiptAppliedAmount || receiptAmount);
      const receipt = await sendWithAuth<CashReceipt>('/api/ar/cash-receipts', 'POST', {
        customer_id: receiptCustomerId,
        total_amount: total,
        payment_method: receiptMethod,
        check_number: receiptMethod === 'check' ? receiptCheckNumber : null,
        applications: receiptInvoiceId ? [{ invoice_id: receiptInvoiceId, applied_amount: applied }] : [],
        idempotency_key: `${receiptCustomerId}:${receiptInvoiceId}:${total}:${applied}:${receiptCheckNumber || receiptMethod}`,
      });
      setReceiptResult(receipt);
      await queryClient.invalidateQueries({ queryKey: ['financial-invoices'] });
    } catch (error) {
      setReceiptError((error as Error).message || 'Could not save cash receipt');
    }
  }

  async function loadAging() {
    setAgingError('');
    try {
      const query = agingDate ? `?asOfDate=${encodeURIComponent(agingDate)}` : '';
      setAgingReport(await fetchWithAuth<AgingReport>(`/api/ar/aging-report${query}`));
    } catch (error) {
      setAgingError((error as Error).message || 'Could not load aging report');
    }
  }

  async function runFinanceCharges(mode: 'preview' | 'commit') {
    setFinanceError('');
    try {
      setFinanceResult(await sendWithAuth<FinanceChargeResult>(`/api/ar/finance-charges/${mode}`, 'POST', {
        runDate: financeRunDate,
      }));
      await queryClient.invalidateQueries({ queryKey: ['financial-invoices'] });
    } catch (error) {
      setFinanceError((error as Error).message || 'Could not run finance charges');
    }
  }

  async function loadJournal() {
    setJournalError('');
    try {
      const params = new URLSearchParams();
      if (journalFrom) params.set('from', journalFrom);
      if (journalTo) params.set('to', journalTo);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const payload = await fetchWithAuth<{ receipts: CashReceipt[] }>(`/api/ar/cash-receipts-journal${suffix}`);
      setJournalRows(payload.receipts || []);
    } catch (error) {
      setJournalError((error as Error).message || 'Could not load receipt journal');
    }
  }

  const rangeTotal = rangeRows.reduce((sum, row) => sum + row.sales, 0);
  const rangeInvoiceCount = rangeRows.reduce((sum, row) => sum + row.invoiceCount, 0);
  const fetchError = invoicesQuery.error ? String((invoicesQuery.error as Error).message || 'Could not load financial data') : '';

  return (
    <div className="space-y-5">
      {invoicesQuery.isPending ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading financial data...</div> : null}
      {fetchError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{fetchError}</div> : null}

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
            {receivables.length.toLocaleString()} customer account{receivables.length === 1 ? '' : 's'} with open invoices totaling <strong>{money(summary.outstanding)}</strong>.
          </div>
          <DataTable
            empty="No unpaid invoices are open right now."
            headers={['Customer', 'Open Invoices', 'Open Balance', 'Oldest Invoice', 'Oldest Due']}
            rows={receivables.map((row) => [
              row.customerLabel,
              row.openInvoiceCount.toLocaleString(),
              money(row.openBalance),
              row.oldestIssueDate ? new Date(`${row.oldestIssueDate}T00:00:00`).toLocaleDateString() : '-',
              row.oldestDueDate ? new Date(`${row.oldestDueDate}T00:00:00`).toLocaleDateString() : '-',
            ])}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'inquiry' ? (
        <Card>
          <CardHeader>
            <CardTitle>Account Inquiry</CardTitle>
            <CardDescription>Customer balances, open invoices, unapplied cash, and recent AR activity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm font-medium text-muted-foreground">
                Customer ID
                <Input value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="w-48" />
              </label>
              <Button onClick={loadInquiry} disabled={inquiryLoading}>{inquiryLoading ? 'Loading...' : 'Load Account'}</Button>
            </div>
            {inquiryError ? <p className="text-sm text-destructive">{inquiryError}</p> : null}
            {inquiry ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <InlineMetric title="Credit Status" value={inquiry.credit_status || 'good'} />
                  <InlineMetric title="Unapplied Cash" value={money(inquiry.unapplied_cash)} />
                  <InlineMetric title="Open Invoices" value={inquiry.open_invoices.length.toLocaleString()} />
                  <InlineMetric title="Current" value={money(inquiry.aging_buckets.current)} />
                </div>
                <DataTable
                  empty="No open invoices."
                  headers={['Invoice', 'Status', 'Due', 'Days Past Due', 'Open Balance']}
                  rows={inquiry.open_invoices.map((invoice) => [
                    invoice.invoice_number || invoice.id,
                    invoice.status || '',
                    invoice.due_date || '',
                    String(invoice.days_past_due ?? 0),
                    money(invoice.open_balance ?? invoice.total),
                  ])}
                />
                <DataTable
                  empty="No recent AR activity."
                  headers={['Type', 'Reference', 'Date', 'Amount', 'Balance']}
                  rows={inquiry.recent_activity.map((entry) => [
                    entry.entry_type,
                    entry.reference_type || '',
                    entry.entry_date || '',
                    money(entry.amount),
                    money(entry.balance_after),
                  ])}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'receipts' ? (
        <Card>
          <CardHeader>
            <CardTitle>Cash Receipts</CardTitle>
            <CardDescription>Apply a receipt to one invoice and leave any remainder unapplied.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Customer ID<Input value={receiptCustomerId} onChange={(e) => setReceiptCustomerId(e.target.value)} /></label>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Invoice ID<Input value={receiptInvoiceId} onChange={(e) => setReceiptInvoiceId(e.target.value)} /></label>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Payment Method<Input value={receiptMethod} onChange={(e) => setReceiptMethod(e.target.value)} /></label>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Receipt Amount<Input type="number" value={receiptAmount} onChange={(e) => setReceiptAmount(e.target.value)} /></label>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Applied Amount<Input type="number" value={receiptAppliedAmount} onChange={(e) => setReceiptAppliedAmount(e.target.value)} /></label>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Check Number<Input value={receiptCheckNumber} onChange={(e) => setReceiptCheckNumber(e.target.value)} /></label>
            </div>
            <Button onClick={saveReceipt}>Save Receipt</Button>
            {receiptError ? <p className="text-sm text-destructive">{receiptError}</p> : null}
            {receiptResult ? <p className="text-sm text-muted-foreground">Saved receipt {receiptResult.id}: {receiptResult.status}, unapplied {money(receiptResult.unapplied_amount || 0)}.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'aging' ? (
        <Card>
          <CardHeader>
            <CardTitle>Aging Report</CardTitle>
            <CardDescription>Open AR grouped by customer and aging bucket.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm font-medium text-muted-foreground">As Of<Input type="date" value={agingDate} onChange={(e) => setAgingDate(e.target.value)} /></label>
              <Button onClick={loadAging}>Run Aging</Button>
            </div>
            {agingError ? <p className="text-sm text-destructive">{agingError}</p> : null}
            <DataTable
              empty="No aging rows loaded."
              headers={['Customer', 'Invoices', 'Current', '30', '60', '90', '120+', 'Total']}
              rows={(agingReport?.rows || []).map((row) => [
                row.customer_name,
                String(row.invoice_count),
                money(row.buckets.current),
                money(row.buckets['30']),
                money(row.buckets['60']),
                money(row.buckets['90']),
                money(row.buckets['120+']),
                money(row.total_open),
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'finance' ? (
        <Card>
          <CardHeader>
            <CardTitle>Finance Charges</CardTitle>
            <CardDescription>Preview calculations before committing AR ledger entries.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Run Date<Input type="date" value={financeRunDate} onChange={(e) => setFinanceRunDate(e.target.value)} /></label>
              <Button variant="outline" onClick={() => runFinanceCharges('preview')}>Preview</Button>
              <Button onClick={() => runFinanceCharges('commit')}>Commit</Button>
            </div>
            {financeError ? <p className="text-sm text-destructive">{financeError}</p> : null}
            {financeResult ? <p className="text-sm text-muted-foreground">{financeResult.mode} total: <strong>{money(financeResult.total_charges)}</strong>{financeResult.idempotent ? ' (already committed)' : ''}</p> : null}
            <DataTable
              empty="No finance charge rows."
              headers={['Customer', 'Invoice', 'Days Overdue', 'Charge']}
              rows={(financeResult?.entries || []).map((entry) => [
                entry.customer_id,
                entry.invoice_id,
                String(entry.days_overdue),
                money(entry.charge_amount),
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'tax' ? (
        <Card>
          <CardHeader>
            <CardTitle>Tax</CardTitle>
            <CardDescription>Invoice tax totals currently loaded in financial reporting.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <InlineMetric title="Taxable Amount" value={money(taxSummary.taxable)} />
              <InlineMetric title="Tax Amount" value={money(taxSummary.tax)} />
              <InlineMetric title="Effective Rate" value={`${taxSummary.effectiveRate.toFixed(2)}%`} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'journals' ? (
        <Card>
          <CardHeader>
            <CardTitle>Journals</CardTitle>
            <CardDescription>Cash receipts by receipt date.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm font-medium text-muted-foreground">From<Input type="date" value={journalFrom} onChange={(e) => setJournalFrom(e.target.value)} /></label>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">To<Input type="date" value={journalTo} onChange={(e) => setJournalTo(e.target.value)} /></label>
              <Button onClick={loadJournal}>Load Journal</Button>
            </div>
            {journalError ? <p className="text-sm text-destructive">{journalError}</p> : null}
            <DataTable
              empty="No receipts loaded."
              headers={['Date', 'Customer', 'Method', 'Status', 'Amount', 'Unapplied']}
              rows={journalRows.map((receipt) => [
                receipt.receipt_date,
                receipt.customer_id,
                receipt.payment_method,
                receipt.status,
                money(receipt.total_amount),
                money(receipt.unapplied_amount || 0),
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle>Daily Sales</CardTitle>
            <CardDescription>Current-day total plus historical date range reporting.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? 'Hide Past Sales' : 'View Past Sales'}
            </Button>
            <Button variant="outline" onClick={handleRefresh}>Refresh</Button>
          </div>
        </CardHeader>
        {showHistory ? (
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm font-medium text-muted-foreground">Start Date<Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">End Date<Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
              <Button className="lg:self-end" onClick={applyRange}>Apply Date Range</Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Sales {startDate || 'Beginning'} to {endDate || 'Today'}: <strong>{money(rangeTotal)}</strong> across <strong>{rangeInvoiceCount.toLocaleString()}</strong> invoices.
            </p>
            <DataTable
              empty="No sales rows in selected range."
              headers={['Date', 'Sales', 'Invoices']}
              rows={rangeRows.map((row) => [row.date, money(row.sales), row.invoiceCount.toLocaleString()])}
            />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function DataTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>{headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? rows.map((row, rowIndex) => (
            <TableRow key={`${rowIndex}-${row.join(':')}`}>
              {row.map((cell, cellIndex) => <TableCell key={`${cellIndex}-${cell}`}>{cell || '-'}</TableCell>)}
            </TableRow>
          )) : (
            <TableRow><TableCell colSpan={headers.length} className="text-muted-foreground">{empty}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function InlineMetric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}
