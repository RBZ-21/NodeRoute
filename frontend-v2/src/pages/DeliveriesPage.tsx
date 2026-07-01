import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useToast } from '../components/ui/toast';
import { StatCard } from '../components/ui/stat-card';
import { Input } from '../components/ui/input';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { TableEmptyState } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type Delivery, useDeliveries, useUpdateDeliveryStatus } from '../hooks/useDeliveries';

type DeliveryViewStatus = 'active' | 'pending' | 'completed' | 'failed' | 'other';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateKey(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeStatus(value: string | undefined): DeliveryViewStatus {
  const status = String(value || '').toLowerCase().replace('_', '-');
  if (status === 'in-transit' || status === 'in-process' || status === 'in-process ') return 'active';
  if (status === 'pending') return 'pending';
  if (status === 'delivered' || status === 'invoiced' || status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'other';
}

function statusBadge(status: DeliveryViewStatus) {
  if (status === 'active') return <Badge variant="success">Out for Delivery</Badge>;
  if (status === 'pending') return <Badge variant="warning">Ready at Shop</Badge>;
  if (status === 'completed') return <Badge variant="neutral">Delivered</Badge>;
  if (status === 'failed') return <Badge variant="neutral" className="bg-red-100 text-red-700">Failed</Badge>;
  return <Badge variant="secondary">Other</Badge>;
}

export function DeliveriesPage() {
  const navigate = useNavigate();
  const { data: deliveries = [], isLoading, isError, error, refetch } = useDeliveries();
  const updateStatus = useUpdateDeliveryStatus();

  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | DeliveryViewStatus>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const filtered = useMemo(() => {
    return deliveries.filter((delivery) => {
      const status = normalizeStatus(delivery.status);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      const etaKey = toDateKey(delivery.expectedWindowEnd || delivery.createdAt);
      if (startDate && etaKey && etaKey < startDate) return false;
      if (endDate && etaKey && etaKey > endDate) return false;
      return true;
    });
  }, [deliveries, statusFilter, startDate, endDate]);

  const summary = useMemo(() => ({
    active: deliveries.filter((d) => normalizeStatus(d.status) === 'active').length,
    pending: deliveries.filter((d) => normalizeStatus(d.status) === 'pending').length,
    completed: deliveries.filter((d) => normalizeStatus(d.status) === 'completed').length,
    failed: deliveries.filter((d) => normalizeStatus(d.status) === 'failed').length,
  }), [deliveries]);

  const selectableIds = useMemo(() => filtered.filter((d) => d.orderDbId).map((d) => d.orderDbId!), [filtered]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleAll() { setSelected(allSelected ? new Set() : new Set(selectableIds)); }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setDeliveryStatus(delivery: Delivery, nextStatus: string) {
    if (!delivery.orderDbId) return;    updateStatus.mutate(
      { id: delivery.orderDbId, status: nextStatus },
      {
        onSuccess: () => toast.success(`Updated ${delivery.orderId || delivery.orderDbId!.slice(0, 8)} to ${nextStatus}.`),
        onError: (err) => toast.error(String((err as Error).message || 'Could not update delivery status')),
      }
    );
  }

  async function bulkSetStatus(nextStatus: string) {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    const ids = Array.from(selected);
    let successCount = 0;
    for (const id of ids) {
      try { await updateStatus.mutateAsync({ id, status: nextStatus }); successCount++; } catch { /* continue */ }
    }
    toast.success(`Bulk updated ${successCount}/${ids.length} deliveries to ${nextStatus}.`);
    setSelected(new Set());
    setBulkUpdating(false);
  }

  return (
    <div className="space-y-5">
      {isLoading ? <PageSkeleton /> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load deliveries')}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active" value={summary.active.toLocaleString()} />
        <StatCard label="Pending" value={summary.pending.toLocaleString()} />
        <StatCard label="Completed" value={summary.completed.toLocaleString()} />
        <StatCard label="Failed" value={summary.failed.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Deliveries</CardTitle>
            <CardDescription>Active and scheduled deliveries from the dispatch backend feed.</CardDescription>
            <p className="text-sm text-muted-foreground">Customer ETA and live tracking should only go live after a delivery is marked out for delivery.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | DeliveryViewStatus)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start Date</span>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">End Date</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>

        {selected.size > 0 && (
          <div className="mx-6 mb-2 flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={bulkUpdating} onClick={() => bulkSetStatus('pending')}>Mark Ready at Shop</Button>
            <Button size="sm" variant="secondary" disabled={bulkUpdating} onClick={() => bulkSetStatus('in-transit')}>Mark Out for Delivery</Button>
            <Button size="sm" disabled={bulkUpdating} onClick={() => bulkSetStatus('delivered')}>{bulkUpdating ? 'Updating...' : 'Mark Delivered'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" /></TableHead>
                <TableHead>Delivery ID</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((delivery, index) => {
                const status = normalizeStatus(delivery.status);
                const deliveryId = delivery.userFacingId || delivery.orderDbId || String(delivery.id || index + 1);
                const eta = delivery.expectedWindowEnd || delivery.createdAt;
                const mapHref = `https://maps.google.com/?q=${encodeURIComponent(`${asNumber(delivery.lat)},${asNumber(delivery.lng)}`)}` ;
                const isChecked = !!delivery.orderDbId && selected.has(delivery.orderDbId);
                return (
                  <TableRow key={deliveryId} className={isChecked ? 'bg-muted/30' : ''}>
                    <TableCell>{delivery.orderDbId ? <input type="checkbox" checked={isChecked} onChange={() => toggleOne(delivery.orderDbId!)} className="cursor-pointer" /> : null}</TableCell>
                    <TableCell className="font-medium">{deliveryId}</TableCell>
                    <TableCell>{delivery.orderId || '-'}</TableCell>
                    <TableCell>{delivery.restaurantName || '-'}</TableCell>
                    <TableCell>{delivery.driverName || '-'}</TableCell>
                    <TableCell>{statusBadge(status)}</TableCell>
                    <TableCell>{delivery.routeId || '-'}</TableCell>
                    <TableCell>{eta ? new Date(eta).toLocaleString() : '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" disabled={!delivery.orderDbId || updateStatus.isPending} onClick={() => setDeliveryStatus(delivery, 'pending')}>Ready at Shop</Button>
                        <Button variant="secondary" size="sm" disabled={!delivery.orderDbId || updateStatus.isPending} onClick={() => setDeliveryStatus(delivery, 'in-transit')}>Out for Delivery</Button>
                        <Button size="sm" disabled={!delivery.orderDbId || updateStatus.isPending} onClick={() => setDeliveryStatus(delivery, 'delivered')}>Delivered</Button>
                        <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex"><Button variant="outline" size="sm">Map</Button></a>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableEmptyState
                  colSpan={9}
                  title="No deliveries found for the selected filters."
                  description="Dispatch a route when work is ready to leave the shop, then delivery activity will appear here."
                  actionLabel="Open Routes"
                  onAction={() => navigate('/routes')}
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
