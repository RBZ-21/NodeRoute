import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type RollupRow = {
  label: string;
  order_count: number;
  invoice_count: number;
  revenue: number;
  margin: number;
  margin_pct: number;
};

type RollupsResponse = {
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

export function AnalyticsPage() {
  const [rollups, setRollups] = useState<RollupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await fetchWithAuth<RollupsResponse>('/api/reporting/rollups?limit=10');
        setRollups(data);
      } catch (err) {
        setError(String((err as Error).message || 'Could not load reporting rollups'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading analytics...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

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
              <TableCell>{money(row.revenue)}</TableCell>
              <TableCell>{money(row.margin)}</TableCell>
              <TableCell>{row.margin_pct.toFixed(1)}%</TableCell>
              {!compact ? <TableCell>{row.order_count.toLocaleString()}</TableCell> : null}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={compact ? 4 : 5}>
              No rollup rows available.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
