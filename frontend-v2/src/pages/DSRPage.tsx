import { useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useDSR, localDateKey } from '../hooks/useDSR';

function money(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function pct(v: number) {
  return `${v.toFixed(1)}%`;
}

function MetricCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: 'up' | 'down' | 'flat' }) {
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const color = trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground';
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      {sub && (
        <div className={`flex items-center gap-1 text-xs font-medium ${color}`}>
          <Icon className="h-3 w-3" />
          {sub}
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-500/15 text-yellow-600 border-yellow-400/30',
  in_process: 'bg-blue-500/15 text-blue-600 border-blue-400/30',
  processed:  'bg-indigo-500/15 text-indigo-600 border-indigo-400/30',
  invoiced:   'bg-emerald-500/15 text-emerald-600 border-emerald-400/30',
  void:       'bg-red-500/15 text-red-500 border-red-400/30',
};

const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending',
  in_process: 'In Process',
  processed:  'Processed',
  invoiced:   'Invoiced',
  void:       'Void',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-muted/40 text-muted-foreground border-border';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function SectionTable({ title, description, rows, cols }: {
  title: string;
  description: string;
  rows: Array<{ label: string; revenue: number; margin: number; margin_pct: number; order_count: number; invoice_count: number }>;
  cols?: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="rounded-lg border border-border bg-card p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{cols?.[0] ?? 'Name'}</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Margin</TableHead>
              <TableHead>Margin %</TableHead>
              <TableHead>Orders</TableHead>
              <TableHead>Invoices</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{r.label || '—'}</TableCell>
                <TableCell>{money(r.revenue)}</TableCell>
                <TableCell className={r.margin >= 0 ? 'text-emerald-600' : 'text-red-500'}>{money(r.margin)}</TableCell>
                <TableCell>{pct(r.margin_pct)}</TableCell>
                <TableCell>{r.order_count}</TableCell>
                <TableCell>{r.invoice_count}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">No data for this period.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function DSRPage() {
  const today = localDateKey(new Date());
  const [dateKey, setDateKey] = useState(today);
  const { rollups, sales, orderStatusCounts, isLoading, isError, refetch } = useDSR(dateKey);

  const overview = rollups?.overview;
  const drivers  = rollups?.driver  ?? [];
  const routes   = rollups?.route   ?? [];
  const customers = rollups?.customer ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Daily Sales Report</h1>
          <p className="text-sm text-muted-foreground">Snapshot of sales, orders, routes, and drivers for the selected date.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateKey}
            max={today}
            onChange={(e) => setDateKey(e.target.value)}
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <Button variant="outline" size="sm" onClick={refetch} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          Could not load DSR data. Check your connection and try again.
        </div>
      )}

      {/* Overview metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Revenue"     value={money(overview?.revenue ?? sales?.total_sales ?? 0)} />
        <MetricCard label="Gross Margin"      value={money(overview?.margin ?? 0)} sub={pct(overview?.margin_pct ?? 0)} trend={overview?.margin_pct != null ? (overview.margin_pct >= 20 ? 'up' : overview.margin_pct >= 0 ? 'flat' : 'down') : undefined} />
        <MetricCard label="Orders"            value={(overview?.order_count ?? 0).toLocaleString()} />
        <MetricCard label="Invoices"          value={(overview?.invoice_count ?? 0).toLocaleString()} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Delivery Sales"   value={money(sales?.delivery_sales ?? 0)} />
        <MetricCard label="Pickup Sales"     value={money(sales?.pickup_sales ?? 0)} />
        <MetricCard label="Avg Invoice"      value={money(sales?.average_invoice ?? 0)} />
        <MetricCard label="Est. COGS"        value={money(overview?.estimated_cost ?? 0)} />
      </div>

      {/* Order status breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Orders by Status</CardTitle>
          <CardDescription>Count of orders in each status for {dateKey}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {orderStatusCounts.length ? orderStatusCounts.map((s) => (
            <div key={s.status} className="flex flex-col items-start gap-1 rounded-lg border border-border bg-muted/20 p-3 min-w-[130px]">
              <StatusBadge status={s.status} />
              <div className="text-2xl font-bold">{s.count}</div>
              <div className="text-xs text-muted-foreground">orders</div>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground">No orders found for this date.</p>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Driver */}
      <SectionTable
        title="Revenue by Driver"
        description="Total revenue, margin, and order count per driver."
        rows={drivers}
        cols={['Driver']}
      />

      {/* Revenue by Route */}
      <SectionTable
        title="Revenue by Route"
        description="Breakdown of revenue and margin per route."
        rows={routes}
        cols={['Route']}
      />

      {/* Top Customers */}
      <SectionTable
        title="Top Customers"
        description="Customers ranked by revenue for the selected date."
        rows={customers.slice(0, 20)}
        cols={['Customer']}
      />
    </div>
  );
}
