import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useToast } from '../components/ui/toast';
import { StatCard } from '../components/ui/stat-card';
import { Input } from '../components/ui/input';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { TableEmptyState } from '../components/ui/data-state';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type StopRecord, type StopStatus, useStops, useUpdateStop } from '../hooks/useStops';

const statusColors = {
  pending: 'yellow',
  arrived: 'blue',
  completed: 'green',
  failed: 'red',
} as const;

function normalizeStatus(value: string | undefined): StopStatus {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
function mapHref(stop: StopRecord): string {
  const explicit = String(stop.mapUrl || stop.map_url || '').trim();
  if (explicit) return explicit;
  const lat = Number(stop.lat);
  const lng = Number(stop.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
  if (stop.address) return `https://maps.google.com/?q=${encodeURIComponent(stop.address)}`;
  return 'https://maps.google.com';
}

export function StopsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeIdParam = searchParams.get('routeId') || '';

  const { data: stops = [], isLoading, isError, error, refetch } = useStops(routeIdParam || undefined);
  const updateStop = useUpdateStop();

  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | StopStatus>('all');
  const [routeFilter, setRouteFilter] = useState<'all' | string>(routeIdParam || 'all');
  const [dateFilter, setDateFilter] = useState('');
  const [statusOverrides, setStatusOverrides] = useState<Record<string, 'completed' | 'failed'>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ driverNotes: string; door_code: string }>({ driverNotes: '', door_code: '' });

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
    return { pending: countByStatus('pending'), arrived: countByStatus('arrived'), completed: countByStatus('completed'), failed: countByStatus('failed') };
  }, [stops, statusOverrides]);

  function setStopStatus(stop: StopRecord, index: number, nextStatus: 'completed' | 'failed') {
    setStatusOverrides((current) => ({ ...current, [stopKey(stop, index)]: nextStatus }));
    toast.success(`Stop ${stopNumberLabel(stop, index)} marked ${nextStatus}.`);
  }

  function startEditNote(stop: StopRecord, index: number) {
    setEditingKey(stopKey(stop, index));
    setNoteDraft({ driverNotes: String(stop.driverNotes || stop.driver_notes || ''), door_code: String(stop.door_code || '') });
  }

  function saveNote(stop: StopRecord, index: number) {
    if (!stop.id) {
      toast.success(`Stop ${stopNumberLabel(stop, index)} notes updated locally.`);
      setEditingKey(null);
      return;
    }
    updateStop.mutate(
      { id: stop.id, patch: { driver_notes: noteDraft.driverNotes, door_code: noteDraft.door_code } },
      { onSuccess: () => { setEditingKey(null); toast.success(`Stop ${stopNumberLabel(stop, index)} notes saved.`); } }
    );
  }

  return (
    <div className="space-y-5">
      {isLoading ? <PageSkeleton /> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load stops')}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending" value={summary.pending.toLocaleString()} />
        <StatCard label="Arrived" value={summary.arrived.toLocaleString()} />
        <StatCard label="Completed" value={summary.completed.toLocaleString()} />
        <StatCard label="Failed" value={summary.failed.toLocaleString()} />
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
              <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | StopStatus)}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="arrived">Arrived</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route</span>
              <SelectInput value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
                <option value="all">All Routes</option>
                {routeOptions.map((route) => <option key={route} value={route}>{route}</option>)}
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</span>
              <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            </label>
            <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
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
                <TableHead>Notes / Door Code</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((stop, index) => {
                const key = stopKey(stop, index);
                const status: StopStatus = statusOverrides[key] ?? normalizeStatus(stop.status);
                const isEditing = editingKey === key;
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{stopNumberLabel(stop, index)}</TableCell>
                    <TableCell>{stop.address || '-'}</TableCell>
                    <TableCell>{customerName(stop)}</TableCell>
                    <TableCell>{orderNumber(stop)}</TableCell>
                    <TableCell><StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                    <TableCell>{stop.arrivalTime || stop.arrival_time ? new Date(stop.arrivalTime || stop.arrival_time || '').toLocaleString() : '-'}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          <Input placeholder="Driver notes..." value={noteDraft.driverNotes} onChange={(e) => setNoteDraft((d) => ({ ...d, driverNotes: e.target.value }))} className="text-xs" />
                          <Input placeholder="Door code..." value={noteDraft.door_code} onChange={(e) => setNoteDraft((d) => ({ ...d, door_code: e.target.value }))} className="text-xs" />
                          <div className="flex gap-1">
                            <Button size="sm" disabled={updateStop.isPending} onClick={() => saveNote(stop, index)}>{updateStop.isPending ? '...' : 'Save'}</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="text-xs">{stop.driverNotes || stop.driver_notes || <span className="text-muted-foreground">No notes</span>}</div>
                          {stop.door_code ? <div className="text-xs text-muted-foreground">Door: {stop.door_code}</div> : null}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {!isEditing && <Button variant="outline" size="sm" onClick={() => startEditNote(stop, index)}>Edit Notes</Button>}
                        <Button variant="secondary" size="sm" onClick={() => setStopStatus(stop, index, 'completed')}>Complete</Button>
                        <Button variant="ghost" size="sm" onClick={() => setStopStatus(stop, index, 'failed')}>Failed</Button>
                        <a href={mapHref(stop)} target="_blank" rel="noreferrer" className="inline-flex">
                          <Button size="sm">Map</Button>
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableEmptyState
                  colSpan={8}
                  title="No stops found for the selected filters."
                  description="Add stops from the route workspace or adjust the filters to review current work."
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
