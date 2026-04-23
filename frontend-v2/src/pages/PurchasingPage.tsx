import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type PurchaseOrder = {
  id: string;
  po_number?: string;
  vendor?: string;
  total_cost?: number | string;
  confirmed_by?: string;
  created_at?: string;
  items?: unknown[];
};

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function PurchasingPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<PurchaseOrder[]>('/api/purchase-orders');
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load purchase orders'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    return {
      count: orders.length,
      spend: orders.reduce((sum, order) => sum + asNumber(order.total_cost), 0),
      vendors: new Set(orders.map((order) => String(order.vendor || '').trim()).filter(Boolean)).size,
    };
  }, [orders]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading purchasing data...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Purchase Orders" value={summary.count.toLocaleString()} />
        <StatCard label="Total Spend" value={money(summary.spend)} />
        <StatCard label="Active Vendors" value={summary.vendors.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Purchasing Orders</CardTitle>
            <CardDescription>Read-only migration view over existing backend APIs.</CardDescription>
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Total Cost</TableHead>
                <TableHead>Line Items</TableHead>
                <TableHead>Confirmed By</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length ? (
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.po_number || order.id.slice(0, 8)}</TableCell>
                    <TableCell>{order.vendor || <Badge variant="neutral">Unspecified</Badge>}</TableCell>
                    <TableCell>{money(asNumber(order.total_cost))}</TableCell>
                    <TableCell>{(order.items || []).length.toLocaleString()}</TableCell>
                    <TableCell>{order.confirmed_by || '-'}</TableCell>
                    <TableCell>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No purchase orders found.
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
