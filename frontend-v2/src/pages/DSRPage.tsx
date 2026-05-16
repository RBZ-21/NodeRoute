import { useMemo, useState } from 'react';
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
  const { rollups, sales, dailyOps, orderStatusCounts, isLoading, isError, refetch } = useDSR(dateKey);

  const overview = rollups?.overview;
  const drivers  = rollups?.driver  ?? [];
  const routes   = rollups?.route   ?? [];
  const customers = dailyOps?.top_customers ?? rollups?.customer ?? [];
  const categoryRows = dailyOps?.on_hand_by_category ?? [];
  const vendorFillRows = dailyOps?.vendor_fill ?? [];
  const shortShipRows = dailyOps?.short_ship_lines ?? [];
  const dailyOpsOverview = dailyOps?.overview;
  const fillTrend = useMemo<'up' | 'down' | 'flat' | undefined>(() => {
    if (dailyOpsOverview == null) return undefined;
    if (dailyOpsOverview.fill_rate_pct >= 97) return 'up';
    if (dailyOpsOverview.fill_rate_pct >= 92) return 'flat';
    return 'down';
  }, [dailyOpsOverview]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Daily Operations Report</h1>
          <p className="text-sm text-muted-foreground">Sales, fill performance, inventory position, and customer concentration for the selected date.</p>
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Fill Rate" value={pct(dailyOpsOverview?.fill_rate_pct ?? 0)} sub={`${(dailyOpsOverview?.accepted_qty ?? 0).toFixed(2)} received on ${(dailyOpsOverview?.requested_qty ?? 0).toFixed(2)} requested`} trend={fillTrend} />
        <MetricCard label="Short-Shipped Qty" value={(dailyOpsOverview?.short_qty ?? 0).toFixed(2)} sub={`${dailyOpsOverview?.short_receipt_line_count ?? 0} receipt line${(dailyOpsOverview?.short_receipt_line_count ?? 0) === 1 ? '' : 's'} flagged`} trend={(dailyOpsOverview?.short_qty ?? 0) > 0 ? 'down' : 'up'} />
        <MetricCard label="Inventory Categories" value={(dailyOpsOverview?.category_count ?? 0).toLocaleString()} sub={`${dailyOpsOverview?.inventory_sku_count ?? 0} active SKUs on hand`} trend="flat" />
        <MetricCard label="Low-Stock SKUs" value={(dailyOpsOverview?.low_stock_sku_count ?? 0).toLocaleString()} sub="Items at or below 5 units on hand" trend={(dailyOpsOverview?.low_stock_sku_count ?? 0) > 0 ? 'down' : 'up'} />
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vendor Fill Snapshot</CardTitle>
            <CardDescription>Today’s receiving performance by vendor, including short receipts and accepted quantity.</CardDescription>
          </CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Fill Rate</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Short</TableHead>
                  <TableHead>Receipts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorFillRows.length ? vendorFillRows.slice(0, 8).map((row) => (
                  <TableRow key={row.vendor}>
                    <TableCell className="font-medium">{row.vendor}</TableCell>
                    <TableCell>{pct(row.fill_rate_pct)}</TableCell>
                    <TableCell>{row.requested_qty.toFixed(2)}</TableCell>
                    <TableCell>{row.accepted_qty.toFixed(2)}</TableCell>
                    <TableCell className={row.short_qty > 0 ? 'text-red-500' : 'text-emerald-600'}>{row.short_qty.toFixed(2)}</TableCell>
                    <TableCell>{row.receipt_count}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">No receiving activity was posted for this date.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>On-Hand by Category</CardTitle>
            <CardDescription>Current inventory position grouped by category so managers can spot stock concentration and low-stock pockets.</CardDescription>
          </CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>SKUs</TableHead>
                  <TableHead>On Hand</TableHead>
                  <TableHead>Stock Value</TableHead>
                  <TableHead>Low Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryRows.length ? categoryRows.slice(0, 8).map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium">{row.category}</TableCell>
                    <TableCell>{row.sku_count}</TableCell>
                    <TableCell>{row.total_on_hand_qty.toFixed(2)}</TableCell>
                    <TableCell>{money(row.estimated_stock_value)}</TableCell>
                    <TableCell className={row.low_stock_sku_count > 0 ? 'text-amber-600' : 'text-emerald-600'}>{row.low_stock_sku_count}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">No inventory rows are available for category rollup.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Short-Ship Exceptions</CardTitle>
          <CardDescription>Receipt lines that landed short against the requested quantity for {dateKey}.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Short</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shortShipRows.length ? shortShipRows.map((row, index) => (
                <TableRow key={`${row.po_number}-${row.product_name}-${index}`}>
                  <TableCell className="font-medium">{row.po_number}</TableCell>
                  <TableCell>{row.vendor}</TableCell>
                  <TableCell>{row.product_name}</TableCell>
                  <TableCell>{row.requested_qty.toFixed(2)}</TableCell>
                  <TableCell>{row.accepted_qty.toFixed(2)}</TableCell>
                  <TableCell className="text-red-500">{row.short_qty.toFixed(2)}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">No short-ship exceptions were logged for this date.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
