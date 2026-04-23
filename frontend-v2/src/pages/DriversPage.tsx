import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type DriverStatus = 'active' | 'off-duty' | 'on-break' | 'other';

type Driver = {
  id?: string | number;
  driverId?: string;
  driver_id?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  phone?: string;
  status?: string;
  assignedRoute?: string;
  assigned_route?: string;
  routeId?: string;
  route_id?: string;
  vehicle?: string;
  vehicleName?: string;
  vehicle_name?: string;
  lastLocation?: string;
  last_location?: string;
  lat?: number | string | null;
  lng?: number | string | null;
};

const statusColors = {
  active: 'green',
  'off-duty': 'gray',
  'on-break': 'yellow',
} as const;

function normalizeStatus(value: string | undefined): DriverStatus {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'active') return 'active';
  if (normalized === 'off-duty') return 'off-duty';
  if (normalized === 'on-break') return 'on-break';
  return 'other';
}

function driverId(driver: Driver, index: number): string {
  return String(driver.driverId || driver.driver_id || driver.id || `DRV-${index + 1}`);
}

function driverName(driver: Driver): string {
  return String(driver.name || driver.fullName || driver.full_name || '-');
}

function assignedRoute(driver: Driver): string {
  return String(driver.assignedRoute || driver.assigned_route || driver.routeId || driver.route_id || '-');
}

function vehicleLabel(driver: Driver): string {
  return String(driver.vehicle || driver.vehicleName || driver.vehicle_name || '-');
}

function locationLabel(driver: Driver): string {
  const explicit = String(driver.lastLocation || driver.last_location || '').trim();
  if (explicit) return explicit;

  const lat = Number(driver.lat);
  const lng = Number(driver.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  return '-';
}

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DriverStatus>('all');
  const [routeFilter, setRouteFilter] = useState<'all' | string>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Driver[]>('/api/drivers');
      setDrivers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load drivers'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const routeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const driver of drivers) {
      const route = assignedRoute(driver);
      if (route && route !== '-') unique.add(route);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [drivers]);

  const filtered = useMemo(() => {
    return drivers.filter((driver) => {
      const status = normalizeStatus(driver.status);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (routeFilter !== 'all' && assignedRoute(driver) !== routeFilter) return false;
      return true;
    });
  }, [drivers, statusFilter, routeFilter]);

  const summary = useMemo(() => {
    const active = drivers.filter((driver) => normalizeStatus(driver.status) === 'active').length;
    const offDuty = drivers.filter((driver) => normalizeStatus(driver.status) === 'off-duty').length;
    const onBreak = drivers.filter((driver) => normalizeStatus(driver.status) === 'on-break').length;
    return { active, offDuty, onBreak };
  }, [drivers]);

  function onAction(action: string, driver: Driver, index: number) {
    setNotice(`${action} queued for ${driverName(driver)} (${driverId(driver, index)}).`);
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading drivers...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Drivers" value={drivers.length.toLocaleString()} />
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="Off Duty" value={summary.offDuty.toLocaleString()} />
        <SummaryCard label="On Break" value={summary.onBreak.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Drivers Operations</CardTitle>
            <CardDescription>Live driver roster and assignment status from `/api/drivers`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | DriverStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="off-duty">Off Duty</option>
                <option value="on-break">On Break</option>
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
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned Route</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Last Location</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((driver, index) => {
                  const id = driverId(driver, index);
                  const status = normalizeStatus(driver.status);
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">{id}</TableCell>
                      <TableCell>{driverName(driver)}</TableCell>
                      <TableCell>{driver.phone || '-'}</TableCell>
                      <TableCell>
                        <StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>{assignedRoute(driver)}</TableCell>
                      <TableCell>{vehicleLabel(driver)}</TableCell>
                      <TableCell>{locationLabel(driver)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => onAction('Details view', driver, index)}>
                            View Details
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => onAction('Route assignment', driver, index)}>
                            Assign Route
                          </Button>
                          <Button size="sm" onClick={() => onAction('Message', driver, index)}>
                            Message Driver
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No drivers found for the selected filters.
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
