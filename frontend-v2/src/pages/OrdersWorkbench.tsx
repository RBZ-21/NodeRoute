import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { asMoney, calcOrderTotal, hasPendingWeight, isWeightManagedItem, normalizedStatus, orderCustomerId, statusVariant } from './orders.types';
import type { Order, OrderStatus } from './orders.types';
import type { Role } from '../lib/api';

type Props = {
  orders: Order[];
  customerIdParam: string;
  search: string;
  setSearch: (v: string) => void;
  status: OrderStatus | 'all';
  setStatus: (v: OrderStatus | 'all') => void;
  weightCaptureOrderId: string | null;
  role: Role;
  onLoad: () => void;
  onEdit: (order: Order) => void;
  onSend: (order: Order) => void;
  onMarkDelivered: (order: Order) => void;
  onResendInvoice: (order: Order) => void;
  onFulfill: (order: Order) => void;
  onToggleWeightCapture: (order: Order) => void;
  onDelete: (id: string) => void;
  onBulkStatusChange: (orderIds: string[], status: OrderStatus) => Promise<void> | void;
};

function hasCatchWeightPending(order: Order): boolean {
  return (order.items || []).some((it) => hasPendingWeight(it));
}

export function OrdersWorkbench({
  orders, customerIdParam, search, setSearch, status, setStatus,
  weightCaptureOrderId, role, onLoad, onEdit, onSend, onMarkDelivered, onResendInvoice, onFulfill,
  onToggleWeightCapture, onDelete, onBulkStatusChange,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<OrderStatus>('in_process');
  const [bulkUpdating, setBulkUpdating] = useState(false);

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

  useEffect(() => {
    const visibleIds = new Set(filtered.map((order) => order.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [filtered]);

  const selectedVisibleIds = filtered.filter((order) => selectedIds.has(order.id)).map((order) => order.id);
  const allVisibleSelected = filtered.length > 0 && selectedVisibleIds.length === filtered.length;

  function toggleOrderSelected(orderId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const order of filtered) {
        if (checked) next.add(order.id);
        else next.delete(order.id);
      }
      return next;
    });
  }

  async function applyBulkStatusChange() {
    if (!selectedVisibleIds.length) return;
    setBulkUpdating(true);
    try {
      await onBulkStatusChange(selectedVisibleIds, bulkStatus);
      setSelectedIds(new Set());
    } finally {
      setBulkUpdating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <CardTitle>Orders Workbench</CardTitle>
          <CardDescription>Move orders from intake to processing, capture weights, and keep the next action obvious for the team.</CardDescription>
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
              <option value="delivered">Delivered</option>
              <option value="invoiced">Invoiced</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <Button variant="outline" onClick={onLoad}>Refresh</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border bg-card p-2">
          <div className="mb-2 flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={allVisibleSelected}
                onChange={(event) => toggleAllVisible(event.target.checked)}
                aria-label="Select all visible orders"
              />
              Select All
              <span className="text-xs font-normal text-muted-foreground">
                {selectedVisibleIds.length} selected
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkStatus}
                onChange={(event) => setBulkStatus(event.target.value as OrderStatus)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Bulk status"
                disabled={!selectedVisibleIds.length || bulkUpdating}
              >
                <option value="pending">Pending</option>
                <option value="in_process">In Process</option>
                <option value="delivered">Delivered</option>
                <option value="invoiced">Invoiced</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void applyBulkStatusChange()}
                disabled={!selectedVisibleIds.length || bulkUpdating}
              >
                {bulkUpdating ? 'Updating...' : 'Apply Bulk Status'}
              </Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Select</span>
                </TableHead>
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
                  const linkedInvoiceId = order.invoice_id || order.invoiceId;
                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedIds.has(order.id)}
                          onChange={(event) => toggleOrderSelected(order.id, event.target.checked)}
                          aria-label={`Select order ${order.order_number || order.id.slice(0, 8)}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="space-y-0.5 text-left"
                          onClick={() => pendingWeights ? onToggleWeightCapture(order) : onEdit(order)}
                        >
                          <span className="hover:underline">{order.order_number || order.id.slice(0, 8)}</span>
                          {pendingWeights && (
                            <div className="text-xs font-medium text-amber-600">⚠️ Weight Pending</div>
                          )}
                        </button>
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
                          <Button variant="ghost" size="sm" onClick={() => onEdit(order)}>Edit Order</Button>
                          {parsedStatus === 'pending' ? (
                            <Button variant="secondary" size="sm" onClick={() => onSend(order)}>Send to Processing</Button>
                          ) : null}
                          {parsedStatus === 'pending' ? (
                            <Button variant="outline" size="sm" onClick={() => onMarkDelivered(order)}>Mark as Delivered</Button>
                          ) : null}
                          {linkedInvoiceId ? (
                            <Button variant="outline" size="sm" onClick={() => onResendInvoice(order)}>Resend Invoice Email</Button>
                          ) : null}
                          {parsedStatus === 'in_process' ? (
                            <Button variant="secondary" size="sm" onClick={() => onFulfill(order)}>Quick Fulfill</Button>
                          ) : null}
                          {(order.items || []).some((it) => isWeightManagedItem(it)) && (role === 'admin' || role === 'manager' || role === 'superadmin') ? (
                            <Button
                              variant={weightCaptureOrderId === order.id ? 'secondary' : 'outline'}
                              size="sm"
                              onClick={() => onToggleWeightCapture(order)}
                            >
                              Enter Weights
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" onClick={() => onDelete(order.id)}>Delete Order</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
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
