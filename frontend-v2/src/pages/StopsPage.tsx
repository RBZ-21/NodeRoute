import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type StopStatus = 'pending' | 'arrived' | 'completed' | 'failed' | 'other';

type StopRecord = {
  id?: string | number;
  stopNumber?: number | string;
  stop_number?: number | string;
  routeId?: string;
  route_id?: string;
  address?: string;
  customer?: string;
  customerName?: string;
  customer_name?: string;
  orderNumber?: string;
  order_number?: string;
  status?: string;
  arrivalTime?: string;
  arrival_time?: string;
  driverNotes?: string;
  driver_notes?: string;
  mapUrl?: string;
  map_url?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  createdAt?: string;
  created_at?: string;
};

const statusColors = {
  pending: 'yellow',
  arrived: 'blue',
  completed: 'green',
  failed: 'red',
} as const;

function normalizeStatus(value: string | undefined): StopStatus {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'pending') return 'pending';
  if (normalized === 'arrived') return 'arrived';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed') return 'failed';
  return 'other';
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

function stopKey(stop: StopRecord, index: number): string {
  return String(stop.id || stop.stopNumber || stop.stop_number || `STOP-${index + 1}`);
}

function stopNumberLabel(stop: StopRecord, index: number): string {
  return String(stop.stopNumber || stop.stop_number || index + 1);
}

function routeId(stop: StopRecord): string {
  return String(stop.routeId || stop.route_id || '-');
}

function customerName(stop: StopRecord): string {
  return String(stop.customer || stop.customerName || stop.customer_name || '-');
}

function orderNumber(stop: StopRecord): string {
  return String(stop.orderNumber || stop.order_number || '-');
}

function driverNotes(stop: StopRecord): string {
  return String(stop.driverNotes || stop.driver_notes || '-');
}

function mapHref(stop: StopRecord): string {
  const explicit = String(stop.mapUrl || stop.map_url || '').trim();
  if (explicit) return explicit;

  const lat = Number(stop.lat);
  const lng = Number(stop.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
  }

  if (stop.address) {
    return `https://maps.google.com/?q=${encodeURIComponent(stop.address)}`;
  }

  return 'https://maps.google.com';
}

export function StopsPage() {
  const [searchParams] = useSearchParams();
  const routeIdParam = searchParams.get('routeId') || '';

  const [stops, setStops] = useState<StopRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StopStatus>('all');
  const [routeFilter, setRouteFilter] = useState<'all' | string>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [statusOverrides, setStatusOverrides] = useState<Record<string, 'completed' | 'failed'>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const query = routeIdParam ? `?routeId=${encodeURIComponent(routeIdParam)}` : '';
      const data = await fetchWithAuth<StopRecord[]>(`/api/stops${query}`);
      setStops(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load stops'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [routeIdParam]);

  useEffect(() => {
    setRouteFilter(routeIdParam || 'all');
  }, [routeIdParam]);

  const routeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const stop of stops) {
      const route = routeId(stop);
      if (route && route !== '-') unique.add(route);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [stops]);

  const filtered = useMemo(() => {
    return stops.filter((stop, index) => {
      const key = stopKey(stop, index);
      const status = statusOverrides[key] || normalizeStatus(stop.status);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (routeFilter !== 'all' && routeId(stop) !== routeFilter) return false;
      if (dateFilter) {
        const dateKey = toDateKey(stop.arrivalTime || stop.arrival_time || stop.createdAt || stop.created_at);
        if (!dateKey || dateKey !== dateFilter) return false;
      }
      return true;
    });
  }, [stops, statusOverrides, statusFilter, routeFilter, dateFilter]);

  const summary = useMemo(() => {
    const countByStatus = (target: StopStatus) =>
      stops.filter((stop, index) => (statusOverrides[stopKey(stop, index)] || normalizeStatus(stop.status)) === target).length;

    return {
      pending: countByStatus('pending'),
      arrived: countByStatus('arrived'),
      completed: countByStatus('completed'),
      failed: countByStatus('failed'),
    };
  }, [stops, statusOverrides]);

  function setStopStatus(stop: StopRecord, index: number, nextStatus: 'completed' | 'failed') {
    const key = stopKey(stop, index);
    setStatusOverrides((current) => ({ ...current, [key]: nextStatus }));
    setNotice(`Stop ${stopNumberLabel(stop, index)} marked ${nextStatus}.`);
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading stops...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}
      {routeIdParam ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Filtered by route from Routes page: <strong>{routeIdParam}</strong>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Pending" value={summary.pending.toLocaleString()} />
        <SummaryCard label="Arrived" value={summary.arrived.toLocaleString()} />
        <SummaryCard label="Completed" value={summary.completed.toLocaleString()} />
        <SummaryCard label="Failed" value={summary.failed.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Stops Operations</CardTitle>
            <CardDescription>Route stop execution feed from `/api/stops`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | StopStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="arrived">Arrived</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route</span>
              <select
                value={routeFilter}
                onChange={(event) => setRouteFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Routes</option>
                {routeOptions.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</span>
              <Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
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
                <TableHead>Stop #</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Arrival Time</TableHead>
                <TableHead>Driver Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((stop, index) => {
                  const key = stopKey(stop, index);
                  const status: StopStatus = statusOverrides[key] ?? normalizeStatus(stop.status);
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{stopNumberLabel(stop, index)}</TableCell>
                      <TableCell>{stop.address || '-'}</TableCell>
                      <TableCell>{customerName(stop)}</TableCell>
                      <TableCell>{orderNumber(stop)}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>{stop.arrivalTime || stop.arrival_time ? new Date(stop.arrivalTime || stop.arrival_time || '').toLocaleString() : '-'}</TableCell>
                      <TableCell>{driverNotes(stop)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="secondary" size="sm" onClick={() => setStopStatus(stop, index, 'completed')}>
                            Mark Complete
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setStopStatus(stop, index, 'failed')}>
                            Mark Failed
                          </Button>
                          <a href={mapHref(stop)} target="_blank" rel="noreferrer" className="inline-flex">
                            <Button size="sm">View on Map</Button>
                          </a>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No stops found for the selected filters.
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
