import { useMemo } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { asMoney, calcOrderTotal, normalizedStatus, orderCustomerId, statusVariant } from './orders.types';
import type { Order, OrderStatus } from './orders.types';

type Props = {
  orders: Order[];
  customerIdParam: string;
  search: string;
  setSearch: (v: string) => void;
  status: OrderStatus | 'all';
  setStatus: (v: OrderStatus | 'all') => void;
  weightCaptureOrderId: string | null;
  role: string;
  onLoad: () => void;
  onEdit: (order: Order) => void;
  onSend: (order: Order) => void;
  onFulfill: (order: Order) => void;
  onToggleWeightCapture: (order: Order) => void;
  onDelete: (id: string) => void;
};

function hasCatchWeightPending(order: Order): boolean {
  return (order.items || []).some((it) => it.is_catch_weight && !(Number(it.actual_weight) > 0));
}

export function OrdersWorkbench({
  orders, customerIdParam, search, setSearch, status, setStatus,
  weightCaptureOrderId, role, onLoad, onEdit, onSend, onFulfill,
  onToggleWeightCapture, onDelete,
}: Props) {
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (customerIdParam && orderCustomerId(order) !== customerIdParam) return false;
      const orderStatus = normalizedStatus(order.status);
      if (status !== 'all' && orderStatus !== status) return false;
      if (!needle) return true;
      return (
        String(order.order_number || '').toLowerCase().includes(needle) ||
        String(order.customer_name || '').toLowerCase().includes(needle)
      );
    });
  }, [orders, customerIdParam, search, status]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <CardTitle>Orders Workbench</CardTitle>
          <CardDescription>Includes edit, send-to-processing, quick fulfill, and delete actions.</CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order # or customer" />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | 'all')}
              className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="in_process">In Process</option>
              <option value="invoiced">Invoiced</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <Button variant="outline" onClick={onLoad}>Refresh</Button>
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
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((order) => {
                  const parsedStatus = normalizedStatus(order.status);
                  const pendingWeights = hasCatchWeightPending(order);
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        <div className="space-y-0.5">
                          <span>{order.order_number || order.id.slice(0, 8)}</span>
                          {pendingWeights && (
                            <div className="text-xs font-medium text-amber-600">⚠️ Weight Pending</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{order.customer_name || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(parsedStatus)}>
                          {String(order.status || 'unknown').replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>{(order.items || []).length.toLocaleString()}</TableCell>
                      <TableCell>{asMoney(calcOrderTotal(order))}</TableCell>
                      <TableCell>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => onEdit(order)}>Edit</Button>
                          {parsedStatus === 'pending' ? (
                            <Button variant="secondary" size="sm" onClick={() => onSend(order)}>Send</Button>
                          ) : null}
                          {parsedStatus === 'in_process' ? (
                            <Button variant="secondary" size="sm" onClick={() => onFulfill(order)}>Fulfill</Button>
                          ) : null}
                          {(order.items || []).some((it) => it.is_catch_weight) && (role === 'admin' || role === 'manager') ? (
                            <Button
                              variant={weightCaptureOrderId === order.id ? 'secondary' : 'outline'}
                              size="sm"
                              onClick={() => onToggleWeightCapture(order)}
                            >
                              Weights
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" onClick={() => onDelete(order.id)}>Delete</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No orders match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
