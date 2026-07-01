import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { PaginationControls } from '../components/ui/pagination';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { ActionMenu } from '../components/ui/action-menu';
import { TableEmptyState } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { asMoney, calcOrderTotal, hasPendingWeight, isWeightManagedItem, normalizedStatus, orderCustomerId, statusVariant } from './orders.types';
import type { Order, OrderStatus } from './orders.types';
import type { Role } from '../lib/api';
import { usePagination } from '../hooks/usePagination';

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
  onCreateOrder: () => void;
};

function hasCatchWeightPending(order: Order): boolean {
  return (order.items || []).some((it) => hasPendingWeight(it));
}

export function OrdersWorkbench({
  orders, customerIdParam, search, setSearch, status, setStatus,
  weightCaptureOrderId, role, onLoad, onEdit, onSend, onMarkDelivered, onResendInvoice, onFulfill,
  onToggleWeightCapture, onDelete, onBulkStatusChange, onCreateOrder,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<OrderStatus>('in_process');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [pageSize, setPageSize] = useState(25);

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
  const pagination = usePagination(filtered, pageSize);

  useEffect(() => {
    const visibleIds = new Set(pagination.pageItems.map((order) => order.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [pagination.pageItems]);

  const selectedVisibleIds = pagination.pageItems.filter((order) => selectedIds.has(order.id)).map((order) => order.id);
  const allVisibleSelected = pagination.pageItems.length > 0 && selectedVisibleIds.length === pagination.pageItems.length;

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
      for (const order of pagination.pageItems) {
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
            <label htmlFor="workbench-search" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</label>
            <Input id="workbench-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order # or customer" />
          </div>
          <div className="space-y-1">
            <label htmlFor="workbench-status" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</label>
            <SelectInput
              id="workbench-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | 'all')}
              className="flex"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="in_process">In Process</option>
              <option value="delivered">Delivered</option>
              <option value="invoiced">Invoiced</option>
              <option value="cancelled">Cancelled</option>
            </SelectInput>
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
              <SelectInput
                value={bulkStatus}
                onChange={(event) => setBulkStatus(event.target.value as OrderStatus)}
                className="h-9 px-2"
                aria-label="Bulk status"
                disabled={!selectedVisibleIds.length || bulkUpdating}
              >
                <option value="pending">Pending</option>
                <option value="in_process">In Process</option>
                <option value="delivered">Delivered</option>
                <option value="invoiced">Invoiced</option>
                <option value="cancelled">Cancelled</option>
              </SelectInput>
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
                pagination.pageItems.map((order) => {
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
                          {String(order.source || '').toLowerCase() === 'portal' && (
                            <Badge variant="secondary" className="ml-1.5 align-middle text-[10px]">Portal</Badge>
                          )}
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
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => onEdit(order)}>Edit Order</Button>
                          <ActionMenu
                            ariaLabel={`Actions for ${order.order_number || order.id.slice(0, 8)}${weightCaptureOrderId === order.id ? ', weight entry open' : ''}`}
                            items={[
                              {
                                label: 'Send to Processing',
                                onClick: () => onSend(order),
                                hidden: parsedStatus !== 'pending',
                              },
                              {
                                label: 'Mark as Delivered',
                                onClick: () => onMarkDelivered(order),
                                hidden: parsedStatus !== 'pending',
                              },
                              {
                                label: 'Resend Invoice Email',
                                onClick: () => onResendInvoice(order),
                                hidden: !linkedInvoiceId,
                              },
                              {
                                label: 'Quick Fulfill',
                                onClick: () => onFulfill(order),
                                hidden: parsedStatus !== 'in_process',
                              },
                              {
                                label: 'Enter Weights',
                                onClick: () => onToggleWeightCapture(order),
                                hidden: !(order.items || []).some((it) => isWeightManagedItem(it)) || !(role === 'admin' || role === 'manager' || role === 'superadmin'),
                              },
                              {
                                label: 'Delete Order',
                                onClick: () => onDelete(order.id),
                                destructive: true,
                              },
                            ]}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableEmptyState
                  colSpan={8}
                  title="No orders match the current filters."
                  description="Create an order or adjust the search and status filters to find existing work."
                  actionLabel="+ New Order"
                  onAction={onCreateOrder}
                />
              )}
            </TableBody>
          </Table>
          {filtered.length ? (
            <PaginationControls
              page={pagination.page}
              pageCount={pagination.pageCount}
              setPage={pagination.setPage}
              itemCount={pagination.itemCount}
              pageSize={pagination.pageSize}
              onPageSizeChange={setPageSize}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
