import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type Delivery = {
  id?: number;
  userFacingId?: string;
  orderDbId?: string;
  orderId?: string;
  restaurantName?: string;
  driverName?: string;
  status?: string;
  routeId?: string | null;
  expectedWindowEnd?: string;
  createdAt?: string;
  lat?: number | string | null;
  lng?: number | string | null;
};

type DeliveryViewStatus = 'active' | 'pending' | 'completed' | 'failed' | 'other';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateKey(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeStatus(value: string | undefined): DeliveryViewStatus {
  const status = String(value || '').toLowerCase().replace('_', '-');
  if (status === 'in-transit' || status === 'in-process' || status === 'in-process ') return 'active';
  if (status === 'pending') return 'pending';
  if (status === 'delivered' || status === 'invoiced' || status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'other';
}

function statusLabel(status: DeliveryViewStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'pending') return 'Pending';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  return 'Other';
}

function statusBadge(status: DeliveryViewStatus) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'pending') return <Badge variant="warning">Pending</Badge>;
  if (status === 'completed') return <Badge variant="neutral">Completed</Badge>;
  if (status === 'failed') return <Badge variant="neutral" className="bg-red-100 text-red-700">Failed</Badge>;
  return <Badge variant="secondary">Other</Badge>;
}

export function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | DeliveryViewStatus>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      // Same data source used by the dashboard dispatch widgets.
      const data = await fetchWithAuth<Delivery[]>('/api/deliveries');
      const rows = Array.isArray(data) ? data : [];
      setDeliveries(rows);

      const today = toDateKey(new Date().toISOString());
      if (!startDate) setStartDate(today);
      if (!endDate) setEndDate(today);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load deliveries'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  const summary = useMemo(() => {
    const active = deliveries.filter((delivery) => normalizeStatus(delivery.status) === 'active').length;
    const pending = deliveries.filter((delivery) => normalizeStatus(delivery.status) === 'pending').length;
    const completed = deliveries.filter((delivery) => normalizeStatus(delivery.status) === 'completed').length;
    const failed = deliveries.filter((delivery) => normalizeStatus(delivery.status) === 'failed').length;
    return { active, pending, completed, failed };
  }, [deliveries]);

  async function setDeliveryStatus(delivery: Delivery, nextStatus: 'pending' | 'in-transit' | 'delivered') {
    if (!delivery.orderDbId) return;
    setUpdatingId(delivery.orderDbId);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/deliveries/${delivery.orderDbId}/status`, 'PATCH', { status: nextStatus });
      setNotice(`Updated ${delivery.orderId || delivery.orderDbId.slice(0, 8)} to ${nextStatus}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not update delivery status'));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading deliveries...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="Pending" value={summary.pending.toLocaleString()} />
        <SummaryCard label="Completed" value={summary.completed.toLocaleString()} />
        <SummaryCard label="Failed" value={summary.failed.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Deliveries</CardTitle>
            <CardDescription>Active and scheduled deliveries from the dispatch backend feed.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | DeliveryViewStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start Date</span>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">End Date</span>
              <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
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
              {filtered.length ? (
                filtered.map((delivery, index) => {
                  const status = normalizeStatus(delivery.status);
                  const deliveryId = delivery.userFacingId || delivery.orderDbId || String(delivery.id || index + 1);
                  const eta = delivery.expectedWindowEnd || delivery.createdAt;
                  const mapHref = `https://maps.google.com/?q=${encodeURIComponent(`${asNumber(delivery.lat)},${asNumber(delivery.lng)}`)}`;
                  return (
                    <TableRow key={deliveryId}>
                      <TableCell className="font-medium">{deliveryId}</TableCell>
                      <TableCell>{delivery.orderId || '-'}</TableCell>
                      <TableCell>{delivery.restaurantName || '-'}</TableCell>
                      <TableCell>{delivery.driverName || '-'}</TableCell>
                      <TableCell>{statusBadge(status)}</TableCell>
                      <TableCell>{delivery.routeId || '-'}</TableCell>
                      <TableCell>{eta ? new Date(eta).toLocaleString() : '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!delivery.orderDbId || updatingId === delivery.orderDbId}
                            onClick={() => setDeliveryStatus(delivery, 'pending')}
                          >
                            Pending
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!delivery.orderDbId || updatingId === delivery.orderDbId}
                            onClick={() => setDeliveryStatus(delivery, 'in-transit')}
                          >
                            Active
                          </Button>
                          <Button
                            size="sm"
                            disabled={!delivery.orderDbId || updatingId === delivery.orderDbId}
                            onClick={() => setDeliveryStatus(delivery, 'delivered')}
                          >
                            Complete
                          </Button>
                          <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex">
                            <Button variant="outline" size="sm">
                              Map
                            </Button>
                          </a>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No deliveries found for the selected filters.
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

