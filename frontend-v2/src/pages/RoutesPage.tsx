import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type RouteStatus = 'active' | 'pending' | 'completed' | 'cancelled' | 'other';

type RouteRecord = {
  id: string;
  name?: string;
  status?: string;
  driver?: string;
  driver_id?: string;
  stop_ids?: string[];
  active_stop_ids?: string[];
  notes?: string;
  created_at?: string;
};

type StopRecord = {
  id: string;
  name?: string;
  address?: string;
  notes?: string;
  lat?: number;
  lng?: number;
};

type PendingOrder = {
  id: string;
  order_number?: string;
  customer_name?: string;
  customer_address?: string;
  customer_email?: string;
  status?: string;
};

type Driver = {
  id: string;
  name?: string;
  email?: string;
};

const statusColors = {
  active: 'green',
  pending: 'yellow',
  completed: 'gray',
  cancelled: 'red',
} as const;

function normalizeStatus(value: string | undefined): RouteStatus {
  const s = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (s === 'active') return 'active';
  if (s === 'pending') return 'pending';
  if (s === 'completed') return 'completed';
  if (s === 'cancelled') return 'cancelled';
  return 'other';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RoutesPage() {
  const navigate = useNavigate();

  // List state
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Supporting data
  const [allStops, setAllStops] = useState<StopRecord[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  // Create route form
  const [newName, setNewName] = useState('');
  const [newDriver, setNewDriver] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit panel
  const [editRoute, setEditRoute] = useState<RouteRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editDriver, setEditDriver] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Add stops from orders
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [addingStops, setAddingStops] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | RouteStatus>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [routeData, stopData, orderData, driverData] = await Promise.all([
        fetchWithAuth<RouteRecord[]>('/api/routes'),
        fetchWithAuth<StopRecord[]>('/api/stops'),
        fetchWithAuth<PendingOrder[]>('/api/orders?status=pending'),
        fetchWithAuth<Driver[]>('/api/users').catch(() => [] as Driver[]),
      ]);
      setRoutes(Array.isArray(routeData) ? routeData : []);
      setAllStops(Array.isArray(stopData) ? stopData : []);
      setPendingOrders((Array.isArray(orderData) ? orderData : []).filter(
        (o) => String(o.status || '').toLowerCase() === 'pending',
      ));
      setDrivers(Array.isArray(driverData) ? driverData : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load routes'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const driverOptions = useMemo(
    () => drivers.map((d) => ({ label: d.name || d.email || '', sublabel: d.email, value: d.id })),
    [drivers],
  );

  const summary = useMemo(() => ({
    active: routes.filter((r) => normalizeStatus(r.status) === 'active').length,
    pending: routes.filter((r) => normalizeStatus(r.status) === 'pending').length,
    completed: routes.filter((r) => normalizeStatus(r.status) === 'completed').length,
  }), [routes]);

  const filtered = useMemo(() =>
    routes.filter((r) => statusFilter === 'all' || normalizeStatus(r.status) === statusFilter),
    [routes, statusFilter],
  );

  // ── Create Route ────────────────────────────────────────────────────────────

  async function createRoute() {
    if (!newName.trim()) { setError('Route name is required.'); return; }
    setCreating(true); setError(''); setNotice('');
    try {
      await sendWithAuth('/api/routes', 'POST', {
        name: newName.trim(),
        driver: newDriver.trim(),
        notes: newNotes.trim(),
        stopIds: [],
      });
      setNotice(`Route "${newName.trim()}" created.`);
      setNewName(''); setNewDriver(''); setNewNotes('');
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not create route'));
    } finally {
      setCreating(false);
    }
  }

  // ── Edit Route ──────────────────────────────────────────────────────────────

  function openEdit(route: RouteRecord) {
    setEditRoute(route);
    setEditName(route.name || '');
    setEditDriver(route.driver || '');
    setEditNotes(route.notes || '');
    setSelectedOrderIds(new Set());
  }

  function closeEdit() {
    setEditRoute(null);
    setSelectedOrderIds(new Set());
  }

  async function saveEdit() {
    if (!editRoute) return;
    if (!editName.trim()) { setError('Route name is required.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await sendWithAuth(`/api/routes/${editRoute.id}`, 'PATCH', {
        name: editName.trim(),
        driver: editDriver.trim(),
        notes: editNotes.trim(),
      });
      setNotice('Route updated.');
      await load();
      // refresh editRoute from updated list
      setEditRoute((prev) => prev ? { ...prev, name: editName.trim(), driver: editDriver.trim(), notes: editNotes.trim() } : null);
    } catch (err) {
      setError(String((err as Error).message || 'Could not update route'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoute(route: RouteRecord) {
    if (!confirm(`Delete route "${route.name || route.id}"?`)) return;
    setError(''); setNotice('');
    try {
      await sendWithAuth(`/api/routes/${route.id}`, 'DELETE');
      setNotice('Route deleted.');
      if (editRoute?.id === route.id) closeEdit();
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete route'));
    }
  }

  // ── Add stops from pending orders ───────────────────────────────────────────

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  }

  async function addOrdersAsStops() {
    if (!editRoute || !selectedOrderIds.size) return;
    setAddingStops(true); setError(''); setNotice('');
    try {
      const orders = pendingOrders.filter((o) => selectedOrderIds.has(o.id));
      const newStopIds: string[] = [];

      for (const order of orders) {
        if (!order.customer_address) continue;
        const stop = await sendWithAuth<StopRecord>('/api/stops', 'POST', {
          name: order.customer_name || order.order_number || order.id,
          address: order.customer_address,
          notes: `Order ${order.order_number || order.id}`,
        });
        if (stop?.id) newStopIds.push(stop.id);
      }

      if (newStopIds.length) {
        const existingIds = editRoute.active_stop_ids || editRoute.stop_ids || [];
        const merged = [...existingIds, ...newStopIds];
        await sendWithAuth(`/api/routes/${editRoute.id}`, 'PATCH', {
          stopIds: merged,
          activeStopIds: merged,
        });
        setEditRoute((prev) => prev ? { ...prev, active_stop_ids: merged, stop_ids: merged } : null);
        setNotice(`${newStopIds.length} stop${newStopIds.length > 1 ? 's' : ''} added to route.`);
        setSelectedOrderIds(new Set());
        await load();
      } else {
        setError('No stops were created — make sure selected orders have a customer address.');
      }
    } catch (err) {
      setError(String((err as Error).message || 'Could not add stops'));
    } finally {
      setAddingStops(false);
    }
  }

  // ── Route stop list ─────────────────────────────────────────────────────────

  const editRouteStops = useMemo(() => {
    if (!editRoute) return [];
    const ids = editRoute.active_stop_ids || editRoute.stop_ids || [];
    return ids.map((id) => allStops.find((s) => s.id === id)).filter(Boolean) as StopRecord[];
  }, [editRoute, allStops]);

  async function removeStop(stopId: string) {
    if (!editRoute) return;
    const ids = (editRoute.active_stop_ids || editRoute.stop_ids || []).filter((id) => id !== stopId);
    try {
      await sendWithAuth(`/api/routes/${editRoute.id}`, 'PATCH', { stopIds: ids, activeStopIds: ids });
      setEditRoute((prev) => prev ? { ...prev, active_stop_ids: ids, stop_ids: ids } : null);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not remove stop'));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading routes...</div> : null}
      {error   ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice  ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Routes" value={routes.length.toLocaleString()} />
        <SummaryCard label="Active"    value={summary.active.toLocaleString()} />
        <SummaryCard label="Pending"   value={summary.pending.toLocaleString()} />
        <SummaryCard label="Completed" value={summary.completed.toLocaleString()} />
      </div>

      {/* ── Create Route ── */}
      <Card>
        <CardHeader>
          <CardTitle>Create Route</CardTitle>
          <CardDescription>Name the route, assign a driver, then add stops from pending orders.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Route Name</span>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Back Side" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Driver</span>
              <Combobox
                value={newDriver}
                onChange={setNewDriver}
                onSelect={(opt) => setNewDriver(opt.label)}
                options={driverOptions}
                placeholder="Assign driver"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Notes</span>
              <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Optional" />
            </label>
            <div className="flex items-end">
              <Button onClick={createRoute} disabled={creating} className="w-full">
                {creating ? 'Creating…' : 'Create Route'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Edit Panel ── */}
      {editRoute ? (
        <Card className="border-primary/40 ring-1 ring-primary/20">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle>Editing: {editRoute.name || editRoute.id}</CardTitle>
              <CardDescription>{(editRoute.active_stop_ids || editRoute.stop_ids || []).length} stop(s) on this route</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={closeEdit}>Close</Button>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Route details */}
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Route Name</span>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Driver</span>
                <Combobox
                  value={editDriver}
                  onChange={setEditDriver}
                  onSelect={(opt) => setEditDriver(opt.label)}
                  options={driverOptions}
                  placeholder="Assign driver"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Notes</span>
                <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </label>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
              <Button variant="ghost" onClick={() => navigate(`/stops?routeId=${editRoute.id}`)}>View All Stops</Button>
              <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => deleteRoute(editRoute)}>Delete Route</Button>
            </div>

            {/* Current stops */}
            {editRouteStops.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground">Current Stops</p>
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editRouteStops.map((stop, i) => (
                        <TableRow key={stop.id}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-medium">{stop.name || '-'}</TableCell>
                          <TableCell>{stop.address || '-'}</TableCell>
                          <TableCell className="text-muted-foreground">{stop.notes || '-'}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeStop(stop.id)}>Remove</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Add from pending orders */}
            {pendingOrders.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground">Add Stops from Pending Orders</p>
                <p className="text-xs text-muted-foreground">Select orders — a stop is created from each customer address.</p>
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Order #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Address</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingOrders.map((order) => (
                        <TableRow
                          key={order.id}
                          className={selectedOrderIds.has(order.id) ? 'bg-primary/5' : 'cursor-pointer hover:bg-muted/40'}
                          onClick={() => toggleOrder(order.id)}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              readOnly
                              checked={selectedOrderIds.has(order.id)}
                              className="h-4 w-4 cursor-pointer accent-primary"
                            />
                          </TableCell>
                          <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                          <TableCell>{order.customer_name || '-'}</TableCell>
                          <TableCell className={order.customer_address ? '' : 'text-muted-foreground italic'}>
                            {order.customer_address || 'No address on order'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  onClick={addOrdersAsStops}
                  disabled={!selectedOrderIds.size || addingStops}
                >
                  {addingStops ? 'Adding…' : `Add ${selectedOrderIds.size || ''} Stop${selectedOrderIds.size !== 1 ? 's' : ''} to Route`}
                </Button>
              </div>
            )}

            {pendingOrders.length === 0 && editRouteStops.length === 0 && (
              <p className="text-sm text-muted-foreground">No pending orders to add. Create orders first.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Routes List ── */}
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Routes</CardTitle>
            <CardDescription>Click Edit to manage stops and assign drivers.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | RouteStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stops</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((route) => {
                const status = normalizeStatus(route.status);
                const stopCount = (route.active_stop_ids || route.stop_ids || []).length;
                const isEditing = editRoute?.id === route.id;
                return (
                  <TableRow key={route.id} className={isEditing ? 'bg-primary/5' : ''}>
                    <TableCell className="font-medium">{route.name || route.id.slice(0, 8)}</TableCell>
                    <TableCell>{route.driver || <span className="text-muted-foreground italic">Unassigned</span>}</TableCell>
                    <TableCell>
                      <StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" />
                    </TableCell>
                    <TableCell>{stopCount}</TableCell>
                    <TableCell>{route.created_at ? new Date(route.created_at).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant={isEditing ? 'secondary' : 'ghost'} size="sm" onClick={() => isEditing ? closeEdit() : openEdit(route)}>
                          {isEditing ? 'Close' : 'Edit'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/stops?routeId=${route.id}`)}>
                          Stops
                        </Button>
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(route.name || '')}`} target="_blank" rel="noreferrer">
                          <Button variant="secondary" size="sm">Map</Button>
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">No routes found.</TableCell>
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
