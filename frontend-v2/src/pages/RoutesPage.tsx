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

function resolvedStopIds(route: RouteRecord, allStops: StopRecord[]) {
  const stopMap = new Set(allStops.map((stop) => String(stop.id)));
  const savedIds = route.active_stop_ids || route.stop_ids || [];
  return savedIds.filter((id) => stopMap.has(String(id)));
}

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

type Customer = {
  id?: string | number;
  customerId?: string;
  customer_id?: string;
  name?: string;
  customerName?: string;
  customer_name?: string;
  company_name?: string;
  address?: string;
  billing_address?: string;
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

  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [allStops, setAllStops] = useState<StopRecord[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

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

  // Single unified add-stop state
  const [stopSearch, setStopSearch] = useState('');
  const [selectedStopCustomerId, setSelectedStopCustomerId] = useState('');
  const [addingStop, setAddingStop] = useState(false);

  // Batch add from pending orders
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [addingStops, setAddingStops] = useState(false);

  const [statusFilter, setStatusFilter] = useState<'all' | RouteStatus>('all');

  // ── AI: Route Optimization ──────────────────────────────────────────────────
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<{
    optimized_stop_ids: string[];
    key_changes: string[];
    estimated_efficiency_gain: string;
    reasoning: string;
  } | null>(null);
  const [optimizeRouteId, setOptimizeRouteId] = useState<string | null>(null);

  async function runOptimizeRoute(routeId: string) {
    setOptimizing(true); setOptimizeResult(null); setOptimizeRouteId(routeId); setError(''); setNotice('');
    try {
      type OptResult = { optimized_stop_ids: string[]; key_changes: string[]; estimated_efficiency_gain: string; reasoning: string };
      const result = await sendWithAuth<OptResult>('/api/ai/optimize-route', 'POST', { route_id: routeId });
      setOptimizeResult(result);
    } catch (err) {
      setError(String((err as Error).message || 'Route optimization failed'));
    } finally {
      setOptimizing(false);
    }
  }

  async function applyOptimization() {
    if (!optimizeRouteId || !optimizeResult) return;
    try {
      await sendWithAuth(`/api/routes/${optimizeRouteId}`, 'PATCH', {
        stopIds: optimizeResult.optimized_stop_ids,
        activeStopIds: optimizeResult.optimized_stop_ids,
      });
      setNotice('Route stop order updated.');
      setOptimizeResult(null); setOptimizeRouteId(null);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not apply optimization'));
    }
  }

  // ── AI: Driver Assignments ──────────────────────────────────────────────────
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsResult, setAssignmentsResult] = useState<{
    assignments: { route_id: string; route_name: string; recommended_driver_name: string; reasoning: string; confidence: string }[];
    unassignable_routes: string[];
    summary: string;
  } | null>(null);

  async function runDriverAssignments() {
    setAssignmentsLoading(true); setAssignmentsResult(null); setError(''); setNotice('');
    try {
      type AssignResult = { assignments: { route_id: string; route_name: string; recommended_driver_name: string; reasoning: string; confidence: string }[]; unassignable_routes: string[]; summary: string };
      const result = await sendWithAuth<AssignResult>('/api/ai/driver-assignments', 'POST', {});
      setAssignmentsResult(result);
    } catch (err) {
      setError(String((err as Error).message || 'Driver assignment failed'));
    } finally {
      setAssignmentsLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [routeData, stopData, orderData, driverData, customerData] = await Promise.all([
        fetchWithAuth<RouteRecord[]>('/api/routes'),
        fetchWithAuth<StopRecord[]>('/api/stops'),
        fetchWithAuth<PendingOrder[]>('/api/orders?status=pending'),
        fetchWithAuth<Driver[]>('/api/users').catch(() => [] as Driver[]),
        fetchWithAuth<Customer[]>('/api/customers').catch(() => [] as Customer[]),
      ]);
      setRoutes(Array.isArray(routeData) ? routeData : []);
      setAllStops(Array.isArray(stopData) ? stopData : []);
      setPendingOrders((Array.isArray(orderData) ? orderData : []).filter(
        (o) => String(o.status || '').toLowerCase() === 'pending',
      ));
      setDrivers(Array.isArray(driverData) ? driverData : []);
      setCustomers(Array.isArray(customerData) ? customerData : []);
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
    setStopSearch('');
    setSelectedStopCustomerId('');
  }

  function closeEdit() {
    setEditRoute(null);
    setSelectedOrderIds(new Set());
    setStopSearch('');
    setSelectedStopCustomerId('');
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

  // ── Stop helpers ────────────────────────────────────────────────────────────

  const editRouteStops = useMemo(() => {
    if (!editRoute) return [];
    const ids = editRoute.active_stop_ids || editRoute.stop_ids || [];
    return ids.map((id) => allStops.find((s) => s.id === id)).filter(Boolean) as StopRecord[];
  }, [editRoute, allStops]);

  const routeStopIds = useMemo(
    () => editRoute?.active_stop_ids || editRoute?.stop_ids || [],
    [editRoute],
  );

  async function patchRouteStops(nextIds: string[]) {
    if (!editRoute) return;
    const dedupedIds = Array.from(new Set(nextIds));
    await sendWithAuth(`/api/routes/${editRoute.id}`, 'PATCH', {
      stopIds: dedupedIds,
      activeStopIds: dedupedIds,
    });
    setEditRoute((prev) => prev ? { ...prev, active_stop_ids: dedupedIds, stop_ids: dedupedIds } : null);
  }

  async function removeStop(stopId: string) {
    if (!editRoute) return;
    const ids = routeStopIds.filter((id) => id !== stopId);
    try {
      await patchRouteStops(ids);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not remove stop'));
    }
  }

  // ── Unified: Add stop from customer search ──────────────────────────────────

  // Options combine customers (with addresses) + pending orders, deduplicated by name
  const stopOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string; sublabel: string; source: 'customer' | 'order' }[] = [];

    for (const customer of customers) {
      const address = String(customer.address || customer.billing_address || '').trim();
      if (!address) continue;
      const name = String(customer.company_name || customer.name || customer.customerName || customer.customer_name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const id = String(customer.id || customer.customerId || customer.customer_id || name);
      opts.push({ value: `customer:${id}`, label: name, sublabel: address, source: 'customer' });
    }

    for (const order of pendingOrders) {
      const address = String(order.customer_address || '').trim();
      if (!address) continue;
      const name = String(order.customer_name || order.order_number || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({ value: `order:${order.id}`, label: name, sublabel: `${address} — Order ${order.order_number || order.id.slice(0, 8)}`, source: 'order' });
    }

    return opts;
  }, [customers, pendingOrders]);

  async function addStopToRoute() {
    if (!editRoute || !selectedStopCustomerId) return;
    setAddingStop(true); setError(''); setNotice('');
    try {
      const opt = stopOptions.find((o) => o.value === selectedStopCustomerId);
      if (!opt) throw new Error('Could not find selected customer');

      // Reuse existing stop if name matches to avoid duplicates
      const existingStop = allStops.find(
        (s) => String(s.name || '').toLowerCase() === opt.label.toLowerCase(),
      );

      let stopId: string;
      if (existingStop && !routeStopIds.includes(existingStop.id)) {
        stopId = existingStop.id;
      } else if (!existingStop) {
        const newStop = await sendWithAuth<StopRecord>('/api/stops', 'POST', {
          name: opt.label,
          address: opt.sublabel.split(' — Order ')[0],
          notes: opt.source === 'order' ? `Order ${opt.sublabel.split('Order ')[1] || ''}`.trim() : '',
        });
        if (!newStop?.id) throw new Error('Stop could not be created');
        stopId = newStop.id;
      } else {
        setNotice(`"${opt.label}" is already on this route.`);
        setAddingStop(false);
        return;
      }

      await patchRouteStops([...routeStopIds, stopId]);
      setNotice(`"${opt.label}" added to route.`);
      setStopSearch('');
      setSelectedStopCustomerId('');
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not add stop'));
    } finally {
      setAddingStop(false);
    }
  }

  // ── Batch add from pending orders ───────────────────────────────────────────

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
      const failed: string[] = [];

      for (const order of orders) {
        const name = order.customer_name || order.order_number || order.id;
        const address = order.customer_address || '';
        if (!address) { failed.push(name); continue; }

        const existingStop = allStops.find(
          (s) => String(s.name || '').toLowerCase() === name.toLowerCase(),
        );

        if (existingStop && !routeStopIds.includes(existingStop.id)) {
          newStopIds.push(existingStop.id);
          continue;
        }
        if (existingStop && routeStopIds.includes(existingStop.id)) continue;

        const stop = await sendWithAuth<StopRecord>('/api/stops', 'POST', {
          name,
          address,
          notes: `Order ${order.order_number || order.id}`,
        });
        if (stop?.id) newStopIds.push(stop.id);
        else failed.push(name);
      }

      if (newStopIds.length) {
        await patchRouteStops([...routeStopIds, ...newStopIds]);
        setNotice(`${newStopIds.length} stop${newStopIds.length > 1 ? 's' : ''} added.${failed.length ? ` Skipped (no address): ${failed.join(', ')}` : ''}`);
        setSelectedOrderIds(new Set());
        await load();
      } else {
        setError(`No stops added. Missing addresses for: ${failed.join(', ')}`);
      }
    } catch (err) {
      setError(String((err as Error).message || 'Could not add stops'));
    } finally {
      setAddingStops(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading routes...</div> : null}
      {error   ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice  ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Routes"    value={routes.length.toLocaleString()} />
        <SummaryCard label="Active"    value={summary.active.toLocaleString()} />
        <SummaryCard label="Pending"   value={summary.pending.toLocaleString()} />
        <SummaryCard label="Completed" value={summary.completed.toLocaleString()} />
      </div>

      {/* ── Create Route ── */}
      <Card>
        <CardHeader>
          <CardTitle>Create Route</CardTitle>
          <CardDescription>Name the route and assign a driver. Add stops after creation.</CardDescription>
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
              <CardDescription>{editRouteStops.length} stop(s) on this route</CardDescription>
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

            {/* ── Add Stop — single unified search ── */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">Add Stop</p>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <Combobox
                  value={stopSearch}
                  onChange={(value) => {
                    setStopSearch(value);
                    setSelectedStopCustomerId('');
                  }}
                  onSelect={(opt) => {
                    setStopSearch(opt.label);
                    setSelectedStopCustomerId(opt.value);
                  }}
                  options={stopOptions}
                  placeholder={stopOptions.length ? 'Search customers or orders…' : 'No customers with saved addresses'}
                />
                <Button
                  onClick={addStopToRoute}
                  disabled={!selectedStopCustomerId || addingStop}
                >
                  {addingStop ? 'Adding…' : 'Add to Route'}
                </Button>
              </div>
              {selectedStopCustomerId && (() => {
                const opt = stopOptions.find((o) => o.value === selectedStopCustomerId);
                return opt ? (
                  <p className="text-xs text-muted-foreground">📍 {opt.sublabel.split(' — Order ')[0]}</p>
                ) : null;
              })()}
            </div>

            {/* Current stops */}
            {editRouteStops.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground">Stops on This Route</p>
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Customer</TableHead>
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

            {/* Batch add from pending orders */}
            {pendingOrders.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground">Batch Add from Pending Orders</p>
                <p className="text-xs text-muted-foreground">Check multiple orders to add them all at once.</p>
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

          </CardContent>
        </Card>
      ) : null}

      {/* ── AI: Driver Assignments ── */}
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">✦ AI Driver Assignments</CardTitle>
            <CardDescription>AI suggests the best driver for each unassigned route based on workload and history.</CardDescription>
          </div>
          <Button onClick={() => void runDriverAssignments()} disabled={assignmentsLoading} variant="outline" size="sm">
            {assignmentsLoading ? 'Analyzing…' : 'Suggest Assignments'}
          </Button>
        </CardHeader>
        {assignmentsResult && (
          <CardContent className="space-y-3">
            {assignmentsResult.summary && <p className="text-sm text-muted-foreground">{assignmentsResult.summary}</p>}
            {assignmentsResult.assignments.length > 0 ? (
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Route</TableHead>
                      <TableHead>Suggested Driver</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Reasoning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignmentsResult.assignments.map((a) => (
                      <TableRow key={a.route_id}>
                        <TableCell className="font-medium">{a.route_name}</TableCell>
                        <TableCell>{a.recommended_driver_name}</TableCell>
                        <TableCell>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${a.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : a.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                            {a.confidence}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{a.reasoning}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : <p className="text-sm text-muted-foreground">No assignment suggestions generated.</p>}
          </CardContent>
        )}
      </Card>

      {/* ── AI: Route Optimization Result ── */}
      {optimizeResult && optimizeRouteId && (
        <Card className="border-primary/40 ring-1 ring-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">✦ Optimized Stop Order</CardTitle>
            <CardDescription>Estimated efficiency gain: {optimizeResult.estimated_efficiency_gain}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{optimizeResult.reasoning}</p>
            {optimizeResult.key_changes.length > 0 && (
              <ul className="space-y-1">
                {optimizeResult.key_changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm"><span className="mt-0.5 text-primary">•</span>{change}</li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void applyOptimization()}>Apply New Order</Button>
              <Button size="sm" variant="ghost" onClick={() => { setOptimizeResult(null); setOptimizeRouteId(null); }}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                const stopCount = resolvedStopIds(route, allStops).length;
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
                        <Button variant="ghost" size="sm" onClick={() => void runOptimizeRoute(route.id)} disabled={optimizing && optimizeRouteId === route.id} title="AI optimize stop order">
                          {optimizing && optimizeRouteId === route.id ? '…' : '✦ Optimize'}
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
