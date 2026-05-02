import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type DriverStatus = 'active' | 'off-duty' | 'on-break' | 'other';

type Driver = {
  id?: string | number;
  driverId?: string;
  driver_id?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  phone?: string;
  email?: string;
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
  license_number?: string;
  notes?: string;
};

const statusColors = {
  active: 'green',
  'off-duty': 'gray',
  'on-break': 'yellow',
} as const;

function normalizeStatus(value: string | undefined): DriverStatus {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
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
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return '-';
}

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DriverStatus>('all');
  const [routeFilter, setRouteFilter] = useState<'all' | string>('all');

  // Detail panel
  const [selected, setSelected] = useState<Driver | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Driver>({});
  const [saving, setSaving] = useState(false);

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

  useEffect(() => { load(); }, []);

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

  const summary = useMemo(() => ({
    active: drivers.filter((d) => normalizeStatus(d.status) === 'active').length,
    offDuty: drivers.filter((d) => normalizeStatus(d.status) === 'off-duty').length,
    onBreak: drivers.filter((d) => normalizeStatus(d.status) === 'on-break').length,
  }), [drivers]);

  function openDriver(driver: Driver) {
    setSelected(driver);
    setDraft({ ...driver });
    setEditing(false);
  }

  async function saveDriver() {
    const id = selected?.id || selected?.driver_id || selected?.driverId;
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const updated = await sendWithAuth<Driver>(`/api/drivers/${id}`, 'PATCH', draft);
      setDrivers((prev) => prev.map((d) => (String(d.id) === String(id) ? { ...d, ...updated } : d)));
      setSelected({ ...selected!, ...updated });
      setEditing(false);
      setNotice(`${draft.name || driverName(draft)} saved.`);
    } catch (err) {
      setError(String((err as Error).message || 'Save failed'));
    } finally {
      setSaving(false);
    }
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
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | DriverStatus)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="off-duty">Off Duty</option>
                <option value="on-break">On Break</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route</span>
              <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All Routes</option>
                {routeOptions.map((route) => <option key={route} value={route}>{route}</option>)}
              </select>
            </label>
            <Button variant="outline" onClick={load}>Refresh</Button>
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
              {filtered.length ? filtered.map((driver, index) => {
                const id = driverId(driver, index);
                const status = normalizeStatus(driver.status);
                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium">{id}</TableCell>
                    <TableCell>{driverName(driver)}</TableCell>
                    <TableCell>{driver.phone || '-'}</TableCell>
                    <TableCell><StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                    <TableCell>{assignedRoute(driver)}</TableCell>
                    <TableCell>{vehicleLabel(driver)}</TableCell>
                    <TableCell>{locationLabel(driver)}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => openDriver(driver)}>View / Edit</Button>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground">No drivers found for the selected filters.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Driver Detail Slide-Over ── */}
      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">{driverName(selected)}</h2>
                <p className="text-sm text-muted-foreground">{driverId(selected, 0)}</p>
              </div>
              <div className="flex gap-2">
                {!editing ? (
                  <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); }}>Cancel</Button>
                    <Button size="sm" disabled={saving} onClick={saveDriver}>{saving ? 'Saving...' : 'Save'}</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>✕</Button>
              </div>
            </div>
            <div className="flex-1 space-y-4 p-6">
              <DriverField label="Full Name" value={draft.name || draft.fullName || draft.full_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
              <DriverField label="Phone" value={draft.phone} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
              <DriverField label="Email" value={draft.email} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
              <DriverField label="Vehicle" value={draft.vehicle || draft.vehicleName || draft.vehicle_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, vehicle: v }))} />
              <DriverField label="License #" value={draft.license_number} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, license_number: v }))} />
              <div className="flex items-start gap-3">
                <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                {editing ? (
                  <select value={draft.status || ''} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="active">Active</option>
                    <option value="off-duty">Off Duty</option>
                    <option value="on-break">On Break</option>
                  </select>
                ) : (
                  <span className="text-sm capitalize">{selected.status || '-'}</span>
                )}
              </div>
              <DriverField label="Notes" value={draft.notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} multiline />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DriverField({ label, value, editing, onChange, multiline }: { label: string; value?: string | null; editing: boolean; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">{label}</span>
      {editing ? (
        multiline ? (
          <textarea className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input className="flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        )
      ) : (
        <span className="text-sm">{value || '-'}</span>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>
  );
}
