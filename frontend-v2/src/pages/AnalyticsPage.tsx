import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type RollupRow, useAnalyticsRollups } from '../hooks/useAnalytics';

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}`;
}
function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function AnalyticsPage() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const [startDate, setStartDate] = useState(localDateKey(thirtyDaysAgo));
  const [endDate, setEndDate] = useState(localDateKey(today));
  const [limit, setLimit] = useState('12');
  const [pendingLimit, setPendingLimit] = useState('12');

  const { data: rollups, isLoading, isError, error, refetch } = useAnalyticsRollups(startDate, endDate, limit);

  const overviewCards = useMemo(() => {
    if (!rollups) return [];
    return [
      { label: 'Revenue', value: money(rollups.overview.revenue) },
      { label: 'Estimated Cost', value: money(rollups.overview.estimated_cost) },
      { label: 'Margin', value: money(rollups.overview.margin) },
      { label: 'Margin %', value: `${rollups.overview.margin_pct.toFixed(1)}%` },
      { label: 'Orders', value: rollups.overview.order_count.toLocaleString() },
      { label: 'Invoices', value: rollups.overview.invoice_count.toLocaleString() },
    ];
  }, [rollups]);

  const analyticsPacks = useMemo(() => {
    const skuRows = rollups?.sku || [];
    const customerRows = rollups?.customer || [];
    const lowMarginRows = skuRows.filter((row) => asNumber(row.margin_pct) < 10).slice(0, 8);
    const projectionRows = skuRows.slice(0, 8).map((row) => ({
      ...row,
      projected: Math.max(0, asNumber(row.qty) * 1.12),
    }));

    return [
      {
        title: 'Gross Profit Trend',
        description: 'Highest gross profit items in the current window.',
        rows: skuRows.slice(0, 8).map((row) => ({ label: row.label, value: asNumber(row.margin) })),
        metric: money(skuRows.reduce((sum, row) => sum + asNumber(row.margin), 0)),
      },
      {
        title: 'Comparative Sales',
        description: 'Top customer sales concentration for the selected range.',
        rows: customerRows.slice(0, 8).map((row) => ({ label: row.label, value: asNumber(row.revenue) })),
        metric: money(customerRows.reduce((sum, row) => sum + asNumber(row.revenue), 0)),
      },
      {
        title: 'Price Exceptions',
        description: 'Low-margin item rows that need pricing review.',
        rows: lowMarginRows.map((row) => ({ label: row.label, value: Math.max(0, 10 - asNumber(row.margin_pct)) })),
        metric: lowMarginRows.length.toLocaleString(),
      },
      {
        title: 'Weekly Projections',
        description: 'Projected next-week movement from current sales velocity.',
        rows: projectionRows.map((row) => ({ label: row.label, value: row.projected })),
        metric: projectionRows.reduce((sum, row) => sum + row.projected, 0).toLocaleString(undefined, { maximumFractionDigits: 1 }),
      },
    ];
  }, [rollups]);

  function downloadCsv(filename: string, rows: string[][]) {
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
  }

  function exportOverviewCsv() {
    if (!rollups) return;
    downloadCsv('analytics-overview.csv', [
      ['Metric', 'Value'],
      ['Orders', String(rollups.overview.order_count)],
      ['Invoices', String(rollups.overview.invoice_count)],
      ['Revenue', String(rollups.overview.revenue)],
      ['Estimated Cost', String(rollups.overview.estimated_cost)],
      ['Margin', String(rollups.overview.margin)],
      ['Margin %', String(rollups.overview.margin_pct)],
      ['Generated At', String(rollups.generated_at || '')],
      ['Start', String(rollups.filters?.start || '')],
      ['End', String(rollups.filters?.end || '')],
    ]);
  }

  function exportRollupsCsv() {
    if (!rollups) return;
    const rows: string[][] = [['Section', 'Label', 'Orders', 'Invoices', 'Revenue', 'Estimated Cost', 'Margin', 'Margin %', 'Qty']];
    const appendSection = (section: string, data: RollupRow[]) => {
      data.forEach((row) => rows.push([section, row.label || '', String(row.order_count || 0), String(row.invoice_count || 0), String(row.revenue || 0), String(row.estimated_cost || 0), String(row.margin || 0), String(row.margin_pct || 0), String(row.qty || 0)]));
    };
    appendSection('customer', rollups.customer || []);
    appendSection('route', rollups.route || []);
    appendSection('driver', rollups.driver || []);
    appendSection('sku', rollups.sku || []);
    downloadCsv('analytics-rollups.csv', rows);
  }

  return (
    <div className="space-y-5">
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading analytics...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load analytics')}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Rollup Filters</CardTitle>
            <CardDescription>Filter reporting window and export current analytics views.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportOverviewCsv} disabled={!rollups}>Export Overview CSV</Button>
            <Button variant="outline" onClick={exportRollupsCsv} disabled={!rollups}>Export Rollups CSV</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Start Date</span>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">End Date</span>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Row Limit</span>
            <Input type="number" min="1" max="500" value={pendingLimit} onChange={(e) => setPendingLimit(e.target.value)} />
          </label>
          <div className="flex items-end gap-2">
            <Button onClick={() => { setLimit(pendingLimit); refetch(); }}>Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {overviewCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="space-y-1">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-2xl">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {analyticsPacks.map((pack) => (
          <Card key={pack.title}>
            <CardHeader className="space-y-1">
              <CardDescription>{pack.title}</CardDescription>
              <CardTitle className="text-2xl">{pack.metric}</CardTitle>
              <CardDescription>{pack.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <MiniBarChart rows={pack.rows} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Customers</CardTitle>
          <CardDescription>Based on current reporting rollups.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <RollupTable rows={rollups?.customer || []} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top Routes</CardTitle></CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <RollupTable rows={rollups?.route || []} compact />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top Drivers</CardTitle></CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <RollupTable rows={rollups?.driver || []} compact />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniBarChart({ rows }: { rows: { label?: string; value: number }[] }) {
  const maxValue = Math.max(1, ...rows.map((row) => asNumber(row.value)));
  if (!rows.length) {
    return <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">No chart data available.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const pct = Math.max(4, Math.min(100, (asNumber(row.value) / maxValue) * 100));
        return (
          <div key={`${row.label || 'row'}-${index}`} className="grid grid-cols-[minmax(0,1fr)_3fr_auto] items-center gap-3 text-sm">
            <div className="truncate text-muted-foreground">{row.label || 'Unassigned'}</div>
            <div className="h-3 overflow-hidden rounded-sm bg-muted">
              <div className="h-full rounded-sm bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <div className="min-w-16 text-right tabular-nums">{asNumber(row.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
          </div>
        );
      })}
    </div>
  );
}

function RollupTable({ rows, compact }: { rows: RollupRow[]; compact?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Label</TableHead>
          <TableHead>Revenue</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Margin</TableHead>
          <TableHead>Margin %</TableHead>
          {!compact ? <TableHead>Orders</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length ? rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell>{money(asNumber(row.revenue))}</TableCell>
            <TableCell>{money(asNumber(row.estimated_cost))}</TableCell>
            <TableCell>{money(asNumber(row.margin))}</TableCell>
            <TableCell>{asNumber(row.margin_pct).toFixed(1)}%</TableCell>
            {!compact ? <TableCell>{asNumber(row.order_count).toLocaleString()}</TableCell> : null}
          </TableRow>
        )) : (
          <TableRow><TableCell className="text-muted-foreground" colSpan={compact ? 5 : 6}>No rollup rows available.</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}
