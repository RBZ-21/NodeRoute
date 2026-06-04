import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type ReportPreset, useSalesReport } from '../hooks/useReports';

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
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

function syncRangeDefaults(preset: ReportPreset): { start: string; end: string } {
  const now = new Date();
  const end = localDateKey(now);
  if (preset === 'daily') return { start: end, end };
  if (preset === 'weekly') {
    const start = new Date(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { start: localDateKey(start), end };
  }
  if (preset === 'monthly') {
    return { start: localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end };
  }
  if (preset === 'yearly') {
    return { start: localDateKey(new Date(now.getFullYear(), 0, 1)), end };
  }
  return { start: end, end };
}

const todayKey = localDateKey(new Date());

export function ReportsPage() {
  const [reportPreset, setReportPreset] = useState<ReportPreset>('daily');
  const [reportStartDate, setReportStartDate] = useState(todayKey);
  const [reportEndDate, setReportEndDate] = useState(todayKey);
  const [reportItemFilter, setReportItemFilter] = useState('all');

  const { data: salesReport, isLoading, isError, error } = useSalesReport(
    reportPreset,
    reportStartDate,
    reportEndDate,
    reportItemFilter
  );

  const reportOverview = salesReport?.overview ?? {
    total_sales: 0, delivery_sales: 0, pickup_sales: 0, unknown_sales: 0,
    invoice_count: 0, order_count: 0, average_invoice: 0, item_count: 0,
  };

  function exportItemSalesCsv() {
    if (!salesReport?.items?.length) return;
    downloadCsv(`reports-item-sales-${reportPreset}-${reportStartDate || 'start'}-${reportEndDate || 'end'}.csv`, [
      ['Item', 'Item Number', 'Qty Sold', 'Revenue', 'Delivery Sales', 'Pickup Sales', 'Invoices'],
      ...salesReport.items.map((item) => [
        item.label,
        item.item_number || '',
        item.qty,
        item.revenue,
        item.delivery_revenue,
        item.pickup_revenue,
        item.invoice_count,
      ]),
    ]);
  }

  return (
    <div className="space-y-5">
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading sales report...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load sales report')}</div> : null}

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
                  if (preset !== 'range') {
                    const { start, end } = syncRangeDefaults(preset);
                    setReportStartDate(start);
                    setReportEndDate(end);
                  }
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
                onChange={(e) => setReportItemFilter(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Items</option>
                {(salesReport?.available_items ?? []).map((item) => (
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
                  <Input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-muted-foreground">End Date</span>
                  <Input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <MiniMetric label="Range Start" value={reportStartDate || '—'} />
                <MiniMetric label="Range End" value={reportEndDate || '—'} />
              </>
            )}
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
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Item Sales</CardTitle>
            <CardDescription>Use the item filter above to focus on a specific product or review all sold items for the selected window.</CardDescription>
          </div>
          <Button variant="outline" onClick={exportItemSalesCsv} disabled={!salesReport?.items?.length}>
            Export Item Sales CSV
          </Button>
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
              {(salesReport?.items ?? []).length ? (
                (salesReport?.items ?? []).map((item) => (
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
                  <TableCell colSpan={6} className="text-muted-foreground">No sales rows found for the selected report filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
