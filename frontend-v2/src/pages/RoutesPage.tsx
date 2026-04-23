import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type RouteStatus = 'active' | 'pending' | 'completed' | 'cancelled' | 'other';

type RouteRecord = {
  id?: string | number;
  routeId?: string;
  route_id?: string;
  name?: string;
  routeName?: string;
  route_name?: string;
  status?: string;
  assignedDriver?: string;
  assigned_driver?: string;
  driverName?: string;
  driver_name?: string;
  totalStops?: number | string;
  total_stops?: number | string;
  completedStops?: number | string;
  completed_stops?: number | string;
  startTime?: string;
  start_time?: string;
  eta?: string;
  mapUrl?: string;
  map_url?: string;
  startLat?: number | string | null;
  startLng?: number | string | null;
  createdAt?: string;
  created_at?: string;
};

const statusColors = {
  active: 'green',
  pending: 'yellow',
  completed: 'gray',
  cancelled: 'red',
} as const;

function normalizeStatus(value: string | undefined): RouteStatus {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'active') return 'active';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'cancelled') return 'cancelled';
  return 'other';
}

function toNumber(value: unknown): number {
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

function routeId(route: RouteRecord, index: number): string {
  return String(route.routeId || route.route_id || route.id || `RTE-${index + 1}`);
}

function routeName(route: RouteRecord): string {
  return String(route.name || route.routeName || route.route_name || '-');
}

function assignedDriver(route: RouteRecord): string {
  return String(route.assignedDriver || route.assigned_driver || route.driverName || route.driver_name || '-');
}

function totalStops(route: RouteRecord): number {
  return toNumber(route.totalStops ?? route.total_stops);
}

function completedStops(route: RouteRecord): number {
  return toNumber(route.completedStops ?? route.completed_stops);
}

function mapHref(route: RouteRecord): string {
  const explicit = String(route.mapUrl || route.map_url || '').trim();
  if (explicit) return explicit;

  const lat = Number(route.startLat);
  const lng = Number(route.startLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
  }

  return 'https://maps.google.com';
}

export function RoutesPage() {
  const navigate = useNavigate();
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RouteStatus>('all');
  const [dateFilter, setDateFilter] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<RouteRecord[]>('/api/routes');
      setRoutes(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load routes'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return routes.filter((route) => {
      const status = normalizeStatus(route.status);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (dateFilter) {
        const dateKey = toDateKey(route.startTime || route.start_time || route.createdAt || route.created_at);
        if (!dateKey || dateKey !== dateFilter) return false;
      }
      return true;
    });
  }, [routes, statusFilter, dateFilter]);

  const summary = useMemo(() => {
    const active = routes.filter((route) => normalizeStatus(route.status) === 'active').length;
    const pending = routes.filter((route) => normalizeStatus(route.status) === 'pending').length;
    const completed = routes.filter((route) => normalizeStatus(route.status) === 'completed').length;
    return { active, pending, completed };
  }, [routes]);

  function openStops(route: RouteRecord, index: number) {
    const id = routeId(route, index);
    navigate(`/stops?routeId=${encodeURIComponent(id)}`);
  }

  function onEdit(route: RouteRecord, index: number) {
    setNotice(`Route editor opened for ${routeName(route)} (${routeId(route, index)}).`);
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading routes...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Routes" value={routes.length.toLocaleString()} />
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="Pending" value={summary.pending.toLocaleString()} />
        <SummaryCard label="Completed" value={summary.completed.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Routes Operations</CardTitle>
            <CardDescription>Live route plan and execution state from `/api/routes`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | RouteStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
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
                <TableHead>Route ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned Driver</TableHead>
                <TableHead>Total Stops</TableHead>
                <TableHead>Completed Stops</TableHead>
                <TableHead>Start Time</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((route, index) => {
                  const id = routeId(route, index);
                  const status = normalizeStatus(route.status);
                  const completed = completedStops(route);
                  const total = totalStops(route);
                  const progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">{id}</TableCell>
                      <TableCell>{routeName(route)}</TableCell>
                      <TableCell>
                        <StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>{assignedDriver(route)}</TableCell>
                      <TableCell>{total.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm">{`${completed.toLocaleString()} / ${total.toLocaleString()}`}</div>
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{route.startTime || route.start_time ? new Date(route.startTime || route.start_time || '').toLocaleString() : '-'}</TableCell>
                      <TableCell>{route.eta ? new Date(route.eta).toLocaleString() : '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openStops(route, index)}>
                            View Stops
                          </Button>
                          <a href={mapHref(route)} target="_blank" rel="noreferrer" className="inline-flex">
                            <Button variant="secondary" size="sm">
                              View on Map
                            </Button>
                          </a>
                          <Button size="sm" onClick={() => onEdit(route, index)}>
                            Edit Route
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    No routes found for the selected filters.
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
