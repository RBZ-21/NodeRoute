import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type RollupRow = {
  label: string;
  order_count: number;
  invoice_count: number;
  revenue: number;
  estimated_cost: number;
  margin: number;
  margin_pct: number;
  qty: number;
};

type RollupsResponse = {
  generated_at?: string;
  filters?: { start?: string | null; end?: string | null; limit?: number };
  overview: {
    order_count: number;
    invoice_count: number;
    revenue: number;
    estimated_cost: number;
    margin: number;
    margin_pct: number;
  };
  customer: RollupRow[];
  route: RollupRow[];
  driver: RollupRow[];
  sku: RollupRow[];
};

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function AnalyticsPage() {
  const [rollups, setRollups] = useState<RollupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState('12');

  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    setEndDate(localDateKey(today));
    setStartDate(localDateKey(thirtyDaysAgo));
  }, []);

  async function loadRollups() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('start', startDate);
      if (endDate) params.set('end', endDate);
      params.set('limit', String(Math.max(1, Math.min(500, asNumber(limit) || 12))));
      const data = await fetchWithAuth<RollupsResponse>(`/api/reporting/rollups?${params.toString()}`);
      setRollups(data);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load reporting rollups'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (startDate || endDate) loadRollups();
  }, [startDate, endDate]);

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
      ['Limit', String(rollups.filters?.limit || '')],
    ]);
  }

  function exportRollupsCsv() {
    if (!rollups) return;
    const rows: string[][] = [['Section', 'Label', 'Orders', 'Invoices', 'Revenue', 'Estimated Cost', 'Margin', 'Margin %', 'Qty']];
    const appendSection = (section: string, data: RollupRow[]) => {
      data.forEach((row) => {
        rows.push([
          section,
          row.label || '',
          String(row.order_count || 0),
          String(row.invoice_count || 0),
          String(row.revenue || 0),
          String(row.estimated_cost || 0),
          String(row.margin || 0),
          String(row.margin_pct || 0),
          String(row.qty || 0),
        ]);
      });
    };
    appendSection('customer', rollups.customer || []);
    appendSection('route', rollups.route || []);
    appendSection('driver', rollups.driver || []);
    appendSection('sku', rollups.sku || []);
    downloadCsv('analytics-rollups.csv', rows);
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading analytics...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Rollup Filters</CardTitle>
            <CardDescription>Filter reporting window and export current analytics views.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportOverviewCsv} disabled={!rollups}>
              Export Overview CSV
            </Button>
            <Button variant="outline" onClick={exportRollupsCsv} disabled={!rollups}>
              Export Rollups CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Start Date</span>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">End Date</span>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Row Limit</span>
            <Input type="number" min="1" max="500" value={limit} onChange={(event) => setLimit(event.target.value)} />
          </label>
          <div className="flex items-end">
            <Button onClick={loadRollups}>Apply Filters</Button>
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
          <CardHeader>
            <CardTitle>Top Routes</CardTitle>
          </CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <RollupTable rows={rollups?.route || []} compact />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Drivers</CardTitle>
          </CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <RollupTable rows={rollups?.driver || []} compact />
          </CardContent>
        </Card>
      </div>
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
        {rows.length ? (
          rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell>{money(asNumber(row.revenue))}</TableCell>
              <TableCell>{money(asNumber(row.estimated_cost))}</TableCell>
              <TableCell>{money(asNumber(row.margin))}</TableCell>
              <TableCell>{asNumber(row.margin_pct).toFixed(1)}%</TableCell>
              {!compact ? <TableCell>{asNumber(row.order_count).toLocaleString()}</TableCell> : null}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={compact ? 5 : 6}>
              No rollup rows available.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
