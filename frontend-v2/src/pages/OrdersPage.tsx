import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type OrderStatus = 'pending' | 'in_process' | 'invoiced' | 'cancelled' | 'unknown';

type OrderItem = {
  quantity?: number | string;
  requested_qty?: number | string;
  unit_price?: number | string;
};

type OrderCharge = {
  amount?: number | string;
};

type Order = {
  id: string;
  order_number?: string;
  customer_name?: string;
  status?: string;
  created_at?: string;
  items?: OrderItem[];
  charges?: OrderCharge[];
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function calcOrderTotal(order: Order): number {
  const itemTotal = (order.items || []).reduce((sum, item) => {
    const qty = asNumber(item.quantity ?? item.requested_qty);
    const unit = asNumber(item.unit_price);
    return sum + qty * unit;
  }, 0);
  const chargeTotal = (order.charges || []).reduce((sum, charge) => sum + asNumber(charge.amount), 0);
  return itemTotal + chargeTotal;
}

function normalizedStatus(value: string | undefined): OrderStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'pending' || status === 'in_process' || status === 'invoiced' || status === 'cancelled') return status;
  return 'unknown';
}

function statusVariant(status: OrderStatus): 'warning' | 'secondary' | 'success' | 'neutral' {
  if (status === 'pending') return 'warning';
  if (status === 'in_process') return 'secondary';
  if (status === 'invoiced') return 'success';
  return 'neutral';
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Order[]>('/api/orders');
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load orders'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((order) => {
      const orderStatus = normalizedStatus(order.status);
      if (status !== 'all' && orderStatus !== status) return false;
      if (!needle) return true;
      return (
        String(order.order_number || '').toLowerCase().includes(needle) ||
        String(order.customer_name || '').toLowerCase().includes(needle)
      );
    });
  }, [orders, search, status]);

  const summary = useMemo(() => {
    const pending = orders.filter((order) => normalizedStatus(order.status) === 'pending').length;
    const inProcess = orders.filter((order) => normalizedStatus(order.status) === 'in_process').length;
    const invoiced = orders.filter((order) => normalizedStatus(order.status) === 'invoiced').length;
    const totalValue = orders.reduce((sum, order) => sum + calcOrderTotal(order), 0);
    return { pending, inProcess, invoiced, totalValue };
  }, [orders]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading orders...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Orders" value={orders.length.toLocaleString()} />
        <SummaryCard title="Pending" value={summary.pending.toLocaleString()} />
        <SummaryCard title="In Process" value={summary.inProcess.toLocaleString()} />
        <SummaryCard title="Total Pipeline Value" value={asMoney(summary.totalValue)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Orders Workbench</CardTitle>
            <CardDescription>Migration phase keeps existing `/api/orders` behavior while modernizing UI.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order # or customer" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as OrderStatus | 'all')}
                className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="in_process">In Process</option>
                <option value="invoiced">Invoiced</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? (
                  filtered.map((order) => {
                    const parsedStatus = normalizedStatus(order.status);
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                        <TableCell>{order.customer_name || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(parsedStatus)}>{String(order.status || 'unknown').replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell>{(order.items || []).length.toLocaleString()}</TableCell>
                        <TableCell>{asMoney(calcOrderTotal(order))}</TableCell>
                        <TableCell>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}</TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No orders match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
