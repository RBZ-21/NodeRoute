import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type ReportPreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'range';

type SalesReportItem = {
  key: string;
  label: string;
  item_number?: string | null;
  qty: number;
  revenue: number;
  invoice_count: number;
  delivery_revenue: number;
  pickup_revenue: number;
};

type SalesReportSummary = {
  generated_at?: string;
  filters?: {
    preset?: string;
    start?: string | null;
    end?: string | null;
    item?: string | null;
  };
  overview: {
    total_sales: number;
    delivery_sales: number;
    pickup_sales: number;
    unknown_sales: number;
    invoice_count: number;
    order_count: number;
    average_invoice: number;
    item_count: number;
  };
  items: SalesReportItem[];
  available_items: Array<{ key: string; label: string; item_number?: string | null }>;
};

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function ReportsPage() {
  const [reportPreset, setReportPreset] = useState<ReportPreset>('daily');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [reportItemFilter, setReportItemFilter] = useState('all');
  const [salesReport, setSalesReport] = useState<SalesReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function syncRangeDefaults(preset: ReportPreset) {
    const now = new Date();
    const end = localDateKey(now);
    if (preset === 'daily') {
      setReportStartDate(end);
      setReportEndDate(end);
      return;
    }
    if (preset === 'weekly') {
      const start = new Date(now);
      const diff = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - diff);
      setReportStartDate(localDateKey(start));
      setReportEndDate(end);
      return;
    }
    if (preset === 'monthly') {
      setReportStartDate(localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)));
      setReportEndDate(end);
      return;
    }
    if (preset === 'yearly') {
      setReportStartDate(localDateKey(new Date(now.getFullYear(), 0, 1)));
      setReportEndDate(end);
    }
  }

  async function loadSalesReport() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('preset', reportPreset);
      if (reportPreset === 'range') {
        if (reportStartDate) params.set('start', reportStartDate);
        if (reportEndDate) params.set('end', reportEndDate);
      }
      if (reportItemFilter !== 'all') params.set('item', reportItemFilter);
      const data = await fetchWithAuth<SalesReportSummary>(`/api/reporting/sales-summary?${params.toString()}`);
      setSalesReport(data);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load sales report'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    syncRangeDefaults('daily');
  }, []);

  useEffect(() => {
    void loadSalesReport();
  }, [reportPreset, reportStartDate, reportEndDate, reportItemFilter]);

  const reportOverview = salesReport?.overview || {
    total_sales: 0,
    delivery_sales: 0,
    pickup_sales: 0,
    unknown_sales: 0,
    invoice_count: 0,
    order_count: 0,
    average_invoice: 0,
    item_count: 0,
  };

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading sales report...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Sales Reports</CardTitle>
          <CardDescription>Daily, weekly, monthly, yearly, or custom-range sales with delivery and pickup splits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['daily', 'weekly', 'monthly', 'yearly', 'range'] as ReportPreset[]).map((preset) => (
              <Button
                key={preset}
                variant={reportPreset === preset ? 'default' : 'outline'}
                onClick={() => {
                  setReportPreset(preset);
                  if (preset !== 'range') syncRangeDefaults(preset);
                }}
              >
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Item Filter</span>
              <select
                value={reportItemFilter}
                onChange={(event) => setReportItemFilter(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Items</option>
                {(salesReport?.available_items || []).map((item) => (
                  <option key={item.key} value={item.item_number || item.label}>
                    {item.label}{item.item_number ? ` (#${item.item_number})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {reportPreset === 'range' ? (
              <>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-muted-foreground">Start Date</span>
                  <Input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-muted-foreground">End Date</span>
                  <Input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} />
                </label>
              </>
            ) : (
              <>
                <MiniMetric label="Range Start" value={reportStartDate || '—'} />
                <MiniMetric label="Range End" value={reportEndDate || '—'} />
              </>
            )}
            <div className="flex items-end">
              <Button variant="outline" onClick={() => void loadSalesReport()}>
                Refresh Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="Total Sales" value={money(reportOverview.total_sales)} />
        <MiniMetric label="Delivery Sales" value={money(reportOverview.delivery_sales)} />
        <MiniMetric label="Pickup Sales" value={money(reportOverview.pickup_sales)} />
        <MiniMetric label="Average Invoice" value={money(reportOverview.average_invoice)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="Invoices" value={reportOverview.invoice_count.toLocaleString()} />
        <MiniMetric label="Orders" value={reportOverview.order_count.toLocaleString()} />
        <MiniMetric label="Matched Items" value={reportOverview.item_count.toLocaleString()} />
        <MiniMetric label="Unclassified Sales" value={money(reportOverview.unknown_sales)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item Sales</CardTitle>
          <CardDescription>Use the item filter above to focus on a specific product or review all sold items for the selected window.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Qty Sold</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Delivery Sales</TableHead>
                <TableHead>Pickup Sales</TableHead>
                <TableHead>Invoices</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(salesReport?.items || []).length ? (
                (salesReport?.items || []).map((item) => (
                  <TableRow key={item.key}>
                    <TableCell className="font-medium">
                      {item.label}
                      {item.item_number ? <div className="text-xs text-muted-foreground">#{item.item_number}</div> : null}
                    </TableCell>
                    <TableCell>{item.qty.toLocaleString()}</TableCell>
                    <TableCell>{money(item.revenue)}</TableCell>
                    <TableCell>{money(item.delivery_revenue)}</TableCell>
                    <TableCell>{money(item.pickup_revenue)}</TableCell>
                    <TableCell>{item.invoice_count.toLocaleString()}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No sales rows found for the selected report filters.
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
