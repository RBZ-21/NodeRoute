import { lazy, Suspense, useMemo, useState } from 'react';
import { getUserRole } from '../lib/api';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { Modal } from '../components/ui/overlay-panel';
import { LiveIndicator } from '../components/ui/live-indicator';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  type AssignmentsResult,
  type Customer,
  type Driver,
  type OptimizeResult,
  type RouteRecord,
  type StopRecord,
  useAllStops,
  useCreateRoute,
  useCreateStop,
  useCustomers,
  useDeleteRoute,
  useDriverAssignments,
  useDrivers,
  useOptimizeRoute,
  usePendingOrders,
  useRoutes,
  useUpdateRoute,
} from '../hooks/useRoutes';
import { AIDriverAssignmentsCard } from './AIDriverAssignmentsCard';
import { RouteOptimizationResultCard } from './RouteOptimizationResultCard';
import { AddStopsModal } from './AddStopsModal';
import { RouteEditPanel } from './RouteEditPanel';
import { driverDisplayName, normalizedLocationKey, normalizeDriverKey, resolveDriverSelection } from './routes.helpers';

// Deliveries and Stops render as tabs inside this page (their old URLs
// redirect here). Lazy so each tab keeps its own chunk.
const DeliveriesTab = lazy(() => import('./DeliveriesPage').then((m) => ({ default: m.DeliveriesPage })));
const StopsTab      = lazy(() => import('./StopsPage').then((m) => ({ default: m.StopsPage })));
const DispatchTab   = lazy(() => import('./DispatchBoard').then((m) => ({ default: m.DispatchBoard })));

type RoutesTab = 'dispatch' | 'routes' | 'deliveries' | 'stops';

const ROUTES_TABS: { id: RoutesTab; label: string }[] = [
  { id: 'dispatch',   label: 'Dispatch Board' },
  { id: 'routes',     label: 'Routes' },
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'stops',      label: 'Stops' },
];

type RouteStatus = 'active' | 'pending' | 'completed' | 'cancelled' | 'other';

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

function resolvedStopIds(route: RouteRecord, allStops: StopRecord[]) {
  const stopMap = new Set(allStops.map((s) => String(s.id)));
  return (route.active_stop_ids || route.stop_ids || []).filter((id) => stopMap.has(String(id)));
}

export function RoutesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  // Dispatch Board is the default tab. Deliveries/Stops/Routes are reachable via ?tab=.
  const activeTab: RoutesTab =
    tabParam === 'deliveries' || tabParam === 'stops' || tabParam === 'routes' ? tabParam : 'dispatch';

  function switchTab(tab: RoutesTab, extraParams: Record<string, string> = {}) {
    const next = new URLSearchParams(searchParams);
    if (tab === 'dispatch') next.delete('tab'); else next.set('tab', tab);
    for (const [key, value] of Object.entries(extraParams)) next.set(key, value);
    setSearchParams(next);
  }

  const { data: routes = [], isLoading, isError, error, refetch, dataUpdatedAt, isFetching } = useRoutes();
  const { data: allStops = [], refetch: refetchStops } = useAllStops();
  const { data: pendingOrders = [] } = usePendingOrders();
  const { data: drivers = [] } = useDrivers();
  const { data: customers = [] } = useCustomers();

  const createRoute = useCreateRoute();
  const updateRoute = useUpdateRoute();
  const deleteRoute = useDeleteRoute();
  const createStop = useCreateStop();
  const optimizeRoute = useOptimizeRoute();
  const driverAssignments = useDriverAssignments();

  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  // Create form (rendered inside the "+ New Route" modal)
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverId, setNewDriverId] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const createFormDirty = newName.trim() !== '' || newDriverName.trim() !== '' || newNotes.trim() !== '';

  function closeCreateModal({ skipConfirm = false }: { skipConfirm?: boolean } = {}) {
    if (!skipConfirm && createFormDirty && !confirm('Discard unsaved route details?')) return;
    setNewName('');
    setNewDriverName('');
    setNewDriverId('');
    setNewNotes('');
    setCreateOpen(false);
  }

  // Edit panel — parent owns only the selection; the panel owns its draft.
  const [editRoute, setEditRoute] = useState<RouteRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editDriverName, setEditDriverName] = useState('');
  const [editDriverId, setEditDriverId] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Stop add
  const [stopSearch, setStopSearch] = useState('');
  const [selectedStopCustomerId, setSelectedStopCustomerId] = useState('');
  const [addingStop, setAddingStop] = useState(false);

  // Batch add
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [addingStops, setAddingStops] = useState(false);

  // Add Stops modal — parent owns only the selection; the modal owns its draft.
  const [addStopsRoute, setAddStopsRoute] = useState<RouteRecord | null>(null);
  const [dispatchCandidate, setDispatchCandidate] = useState<RouteRecord | null>(null);

  // AI
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [optimizeRouteId, setOptimizeRouteId] = useState<string | null>(null);
  const [assignmentsResult, setAssignmentsResult] = useState<AssignmentsResult | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | RouteStatus>('all');

  const role = getUserRole();
  const canManageStops = role === 'admin' || role === 'manager' || role === 'superadmin';

  const driverById = useMemo(
    () => new Map(drivers.map((driver) => [String(driver.id), driver])),
    [drivers],
  );

  const driverOptions = useMemo(
    () => drivers.map((d) => ({ label: d.name || d.email || '', sublabel: d.email, value: d.id })),
    [drivers],
  );

  const linkedNewDriver = newDriverId ? driverById.get(newDriverId) : undefined;
  const linkedEditDriver = editDriverId ? driverById.get(editDriverId) : undefined;

  const summary = useMemo(() => ({
    active: routes.filter((r) => normalizeStatus(r.status) === 'active').length,
    pending: routes.filter((r) => normalizeStatus(r.status) === 'pending').length,
    completed: routes.filter((r) => normalizeStatus(r.status) === 'completed').length,
  }), [routes]);

  const filtered = useMemo(() =>
    routes.filter((r) => statusFilter === 'all' || normalizeStatus(r.status) === statusFilter),
    [routes, statusFilter],
  );

  const routeStopIds = useMemo(
    () => editRoute?.active_stop_ids || editRoute?.stop_ids || [],
    [editRoute],
  );

  const editRouteStops = useMemo(() => {
    if (!editRoute) return [];
    return routeStopIds.map((id) => allStops.find((s) => s.id === id)).filter(Boolean) as StopRecord[];
  }, [editRoute, allStops, routeStopIds]);

  const stopOptions = useMemo(() => {
    const seen = new Set<string>();
    const routeStopIdentitySet = new Set(editRouteStops.map((stop) => normalizedLocationKey(stop.name, stop.address)));
    const opts: { value: string; label: string; sublabel: string; address: string; entityId: string; source: 'customer' | 'order' }[] = [];
    for (const c of customers) {
      const address = String((c as Customer).address || (c as Customer).billing_address || '').trim();
      if (!address) continue;
      const name = String((c as Customer).company_name || (c as Customer).name || (c as Customer).customerName || (c as Customer).customer_name || '').trim();
      if (!name) continue;
      const key = normalizedLocationKey(name, address);
      if (seen.has(key) || routeStopIdentitySet.has(key)) continue;
      seen.add(key);
      const id = String((c as Customer).id || (c as Customer).customerId || (c as Customer).customer_id || name);
      opts.push({ value: `customer:${id}`, label: name, sublabel: address, address, entityId: id, source: 'customer' });
    }
    for (const o of pendingOrders) {
      const address = String(o.customer_address || '').trim();
      if (!address) continue;
      const name = String(o.customer_name || o.order_number || '').trim();
      if (!name) continue;
      const key = normalizedLocationKey(name, address);
      if (seen.has(key) || routeStopIdentitySet.has(key)) continue;
      seen.add(key);
      opts.push({
        value: `order:${o.id}`,
        label: name,
        sublabel: `${address} — Order ${o.order_number || o.id.slice(0, 8)}`,
        address,
        entityId: o.id,
        source: 'order',
      });
    }
    return opts;
  }, [customers, editRouteStops, pendingOrders]);

  const batchPendingOrders = useMemo(() => {
    const routeStopIdentitySet = new Set(editRouteStops.map((stop) => normalizedLocationKey(stop.name, stop.address)));
    return pendingOrders.filter((order) => !routeStopIdentitySet.has(normalizedLocationKey(order.customer_name || order.order_number, order.customer_address)));
  }, [editRouteStops, pendingOrders]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const [showOptimizeHint, setShowOptimizeHint] = useState(false);

  async function patchRouteStops(routeId: string, nextIds: string[]) {
    const dedupedIds = Array.from(new Set(nextIds));
    await updateRoute.mutateAsync({ id: routeId, patch: { stopIds: dedupedIds, activeStopIds: dedupedIds } });
    setEditRoute((prev) => prev ? { ...prev, active_stop_ids: dedupedIds, stop_ids: dedupedIds } : null);
    await refetchStops();
    if (dedupedIds.length > 1) setShowOptimizeHint(true);
  }

  function openEdit(route: RouteRecord) {
    const resolvedLegacyDriver = resolveDriverSelection(drivers, route.driver || '', '');
    const matchedDriver = route.driver_id
      ? driverById.get(String(route.driver_id))
      : resolvedLegacyDriver?.driverId
        ? driverById.get(String(resolvedLegacyDriver.driverId))
        : undefined;
    setEditRoute(route);
    setEditName(route.name || '');
    setEditDriverName(route.driver || driverDisplayName(matchedDriver) || '');
    setEditDriverId(String(route.driver_id || matchedDriver?.id || ''));
    setEditNotes(route.notes || '');
    setSelectedOrderIds(new Set());
    setStopSearch('');
    setSelectedStopCustomerId('');
  }

  function closeEdit() {
    setEditRoute(null);
    setEditDriverName('');
    setEditDriverId('');
    setSelectedOrderIds(new Set());
    setStopSearch('');
    setSelectedStopCustomerId('');
  }

  function handleNewDriverChange(value: string) {
    setNewDriverName(value);
    const selectedDriver = driverById.get(newDriverId);
    if (!selectedDriver) {
      setNewDriverId('');
      return;
    }
    const normalizedValue = normalizeDriverKey(value);
    const keepSelected =
      normalizedValue &&
      (
        normalizeDriverKey(selectedDriver.name) === normalizedValue
        || normalizeDriverKey(selectedDriver.email) === normalizedValue
      );
    if (!keepSelected) setNewDriverId('');
  }

  function handleEditDriverChange(value: string) {
    setEditDriverName(value);
    const selectedDriver = driverById.get(editDriverId);
    if (!selectedDriver) {
      setEditDriverId('');
      return;
    }
    const normalizedValue = normalizeDriverKey(value);
    const keepSelected =
      normalizedValue &&
      (
        normalizeDriverKey(selectedDriver.name) === normalizedValue
        || normalizeDriverKey(selectedDriver.email) === normalizedValue
      );
    if (!keepSelected) setEditDriverId('');
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleCreateRoute() {
    if (!newName.trim()) { setActionError('Route name is required.'); return; }
    const resolvedDriver = resolveDriverSelection(drivers, newDriverName, newDriverId);
    if (!resolvedDriver) {
      setActionError('Choose a driver from the saved user list or leave the route unassigned.');
      return;
    }
    setActionError('');
    createRoute.mutate(
      { name: newName.trim(), driver: resolvedDriver.driverName, driverId: resolvedDriver.driverId, notes: newNotes.trim() },
      {
        onSuccess: () => {
          setNotice(`Route "${newName.trim()}" created.`);
          closeCreateModal({ skipConfirm: true });
        },
        onError: (err) => setActionError(String((err as Error).message || 'Could not create route')),
      }
    );
  }

  function handleSaveEdit() {
    if (!editRoute || !editName.trim()) { setActionError('Route name is required.'); return; }
    const resolvedDriver = resolveDriverSelection(drivers, editDriverName, editDriverId);
    if (!resolvedDriver) {
      setActionError('Choose a driver from the saved user list or clear the route assignment.');
      return;
    }
    setActionError('');
    updateRoute.mutate(
      { id: editRoute.id, patch: { name: editName.trim(), driver: resolvedDriver.driverName, driverId: resolvedDriver.driverId, notes: editNotes.trim() } },
      {
        onSuccess: () => {
          setNotice('Route updated.');
          setEditRoute((prev) => prev ? { ...prev, name: editName.trim(), driver: resolvedDriver.driverName, driver_id: resolvedDriver.driverId, notes: editNotes.trim() } : null);
          setEditDriverName(resolvedDriver.driverName);
          setEditDriverId(String(resolvedDriver.driverId || ''));
        },
        onError: (err) => setActionError(String((err as Error).message || 'Could not update route')),
      }
    );
  }

  function handleDeleteRoute(route: RouteRecord) {
    if (!confirm(`Delete route "${route.name || route.id}"?`)) return;
    setActionError('');
    deleteRoute.mutate(route.id, {
      onSuccess: () => { setNotice('Route deleted.'); if (editRoute?.id === route.id) closeEdit(); },
      onError: (err) => setActionError(String((err as Error).message || 'Could not delete route')),
    });
  }

  function handleRemoveStop(stopId: string) {
    if (!editRoute) return;
    const stop = editRouteStops.find((item) => item.id === stopId);
    const stopLabel = stop?.name || stop?.address || stopId;
    if (!confirm(`Remove stop "${stopLabel}" from route "${editRoute.name || editRoute.id}"?`)) return;
    setActionError('');
    patchRouteStops(editRoute.id, routeStopIds.filter((id) => id !== stopId))
      .catch((err) => setActionError(String((err as Error).message || 'Could not remove stop')));
  }

  async function handleAddStopToRoute() {
    if (!editRoute || !selectedStopCustomerId) return;
    setAddingStop(true);
    setActionError('');
    try {
      const opt = stopOptions.find((o) => o.value === selectedStopCustomerId);
      if (!opt) throw new Error('Could not find selected customer');
      const existingStop = allStops.find((s) => normalizedLocationKey(s.name, s.address) === normalizedLocationKey(opt.label, opt.address));
      let stopId: string;
      if (existingStop && !routeStopIds.includes(existingStop.id)) {
        stopId = existingStop.id;
      } else if (!existingStop) {
        const newStop = await createStop.mutateAsync({
          name: opt.label,
          address: opt.address,
          notes: opt.source === 'order' ? `Order ${opt.sublabel.split('Order ')[1] || ''}`.trim() : '',
          customer_id: opt.source === 'customer' ? opt.entityId : undefined,
        });
        if (!newStop?.id) throw new Error('Stop could not be created');
        stopId = newStop.id;
      } else {
        setNotice(`"${opt.label}" is already on this route.`);
        return;
      }
      await patchRouteStops(editRoute.id, [...routeStopIds, stopId]);
      setNotice(`"${opt.label}" added to route.`);
      setStopSearch('');
      setSelectedStopCustomerId('');
    } catch (err) {
      setActionError(String((err as Error).message || 'Could not add stop'));
    } finally {
      setAddingStop(false);
    }
  }

  async function handleAddOrdersAsStops() {
    if (!editRoute || !selectedOrderIds.size) return;
    setAddingStops(true);
    setActionError('');
    try {
      const orders = pendingOrders.filter((o) => selectedOrderIds.has(o.id));
      const newStopIds: string[] = [];
      const failed: string[] = [];
      for (const order of orders) {
        const name = order.customer_name || order.order_number || order.id;
        const address = order.customer_address || '';
        if (!address) { failed.push(name); continue; }
        const existingStop = allStops.find((s) => normalizedLocationKey(s.name, s.address) === normalizedLocationKey(name, address));
        if (existingStop && !routeStopIds.includes(existingStop.id)) { newStopIds.push(existingStop.id); continue; }
        if (existingStop && routeStopIds.includes(existingStop.id)) continue;
        const stop = await createStop.mutateAsync({ name, address, notes: `Order ${order.order_number || order.id}` });
        if (stop?.id) newStopIds.push(stop.id); else failed.push(name);
      }
      if (newStopIds.length) {
        await patchRouteStops(editRoute.id, [...routeStopIds, ...newStopIds]);
        setNotice(`${newStopIds.length} stop${newStopIds.length > 1 ? 's' : ''} added.${failed.length ? ` Skipped (no address): ${failed.join(', ')}` : ''}`);
        setSelectedOrderIds(new Set());
      } else {
        setActionError(`No stops added. Missing addresses for: ${failed.join(', ')}`);
      }
    } catch (err) {
      setActionError(String((err as Error).message || 'Could not add stops'));
    } finally {
      setAddingStops(false);
    }
  }

  function handleRunOptimize(routeId: string) {
    setOptimizeResult(null); setOptimizeRouteId(routeId); setActionError('');
    optimizeRoute.mutate(routeId, {
      onSuccess: (result) => setOptimizeResult(result),
      onError: (err) => setActionError(String((err as Error).message || 'Route optimization failed')),
    });
  }

  function handleApplyOptimization() {
    if (!optimizeRouteId || !optimizeResult) return;
    updateRoute.mutate(
      { id: optimizeRouteId, patch: { stopIds: optimizeResult.optimized_stop_ids, activeStopIds: optimizeResult.optimized_stop_ids } },
      {
        onSuccess: () => { setNotice('Route stop order updated.'); setOptimizeResult(null); setOptimizeRouteId(null); },
        onError: (err) => setActionError(String((err as Error).message || 'Could not apply optimization')),
      }
    );
  }

  function handleDriverAssignments() {
    setAssignmentsResult(null); setActionError('');
    driverAssignments.mutate(undefined, {
      onSuccess: (result) => setAssignmentsResult(result),
      onError: (err) => setActionError(String((err as Error).message || 'Driver assignment failed')),
    });
  }

  function handleApplyDriverSuggestion(routeId: string, recommendedDriverName: string) {
    const resolvedDriver = resolveDriverSelection(drivers, recommendedDriverName, '');
    if (!resolvedDriver?.driverId) {
      setActionError(`Could not link "${recommendedDriverName}" to a saved driver user.`);
      return;
    }
    const linkedDriverId = resolvedDriver.driverId;
    setActionError('');
    updateRoute.mutate(
      { id: routeId, patch: { driver: resolvedDriver.driverName, driverId: linkedDriverId } },
      {
        onSuccess: () => {
          setNotice(`Assigned ${resolvedDriver.driverName} to the route.`);
          setAssignmentsResult((prev) => prev ? {
            ...prev,
            assignments: prev.assignments.filter((assignment) => assignment.route_id !== routeId),
          } : null);
          if (editRoute?.id === routeId) {
            setEditDriverName(resolvedDriver.driverName);
            setEditDriverId(linkedDriverId);
            setEditRoute((prev) => prev ? { ...prev, driver: resolvedDriver.driverName, driver_id: linkedDriverId } : null);
          }
        },
        onError: (err) => setActionError(String((err as Error).message || 'Could not apply driver assignment')),
      },
    );
  }

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  }

  function handleDispatchRoute(route: RouteRecord) {
    const assignedDriverId = String(route.driver_id || '').trim();
    if (!assignedDriverId) {
      setNotice('');
      setActionError(`Assign a driver before dispatching "${route.name || route.id.slice(0, 8)}".`);
      return;
    }
    setActionError('');
    setDispatchCandidate(route);
  }

  function confirmDispatchRoute() {
    if (!dispatchCandidate) return;
    const route = dispatchCandidate;
    const assignedDriverId = String(route.driver_id || '').trim();
    if (!assignedDriverId) {
      setDispatchCandidate(null);
      setNotice('');
      setActionError(`Assign a driver before dispatching "${route.name || route.id.slice(0, 8)}".`);
      return;
    }
    setActionError('');
    setDispatchCandidate(null);
    updateRoute.mutate(
      { id: route.id, patch: { status: 'active', dispatched_at: new Date().toISOString() } },
      {
        onSuccess: () => setNotice(`Route "${route.name || route.id.slice(0, 8)}" marked as departed. Customer ETA and live tracking can now begin.`),
        onError: (err) => setActionError(String((err as Error).message || 'Could not dispatch route')),
      },
    );
  }

  function handleCancelDispatch(route: RouteRecord) {
    const routeLabel = route.name || route.id.slice(0, 8);
    const confirmed = confirm(`Cancel dispatch for "${routeLabel}"? Customer ETA and live tracking will pause until this route is dispatched again.`);
    if (!confirmed) return;
    setActionError('');
    updateRoute.mutate(
      { id: route.id, patch: { status: 'pending', dispatched_at: null } },
      {
        onSuccess: () => setNotice(`Dispatch cancelled for "${routeLabel}". Customer ETA and live tracking are paused until dispatch starts again.`),
        onError: (err) => setActionError(String((err as Error).message || 'Could not cancel dispatch')),
      },
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Tabs: Routes | Deliveries | Stops ── */}
      <div className="flex items-center gap-1 border-b border-border" role="tablist" aria-label="Routes sections">
        {ROUTES_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => switchTab(tab.id)}
            className={[
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors -mb-px',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab !== 'routes' ? (
        <Suspense fallback={<div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading…</div>}>
          {activeTab === 'dispatch' ? <DispatchTab /> : activeTab === 'deliveries' ? <DeliveriesTab /> : <StopsTab />}
        </Suspense>
      ) : (
      <>
      {dispatchCandidate ? (() => {
        const routeLabel = dispatchCandidate.name || dispatchCandidate.id.slice(0, 8);
        const driverLabel = dispatchCandidate.driver || driverDisplayName(driverById.get(String(dispatchCandidate.driver_id || ''))) || 'Unassigned';
        const stopCount = resolvedStopIds(dispatchCandidate, allStops).length;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-labelledby="dispatch-confirm-title">
            <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl">
              <div className="space-y-1">
                <h2 id="dispatch-confirm-title" className="text-lg font-semibold">Dispatch route?</h2>
                <p className="text-sm text-muted-foreground">Customer ETA and live tracking will begin for this route.</p>
              </div>
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Route</dt>
                  <dd className="font-medium text-right">{routeLabel}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Driver</dt>
                  <dd className="font-medium text-right">{driverLabel}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Stops</dt>
                  <dd className="font-medium text-right">{stopCount}</dd>
                </div>
              </dl>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setDispatchCandidate(null)}>Cancel</Button>
                <Button onClick={confirmDispatchRoute} disabled={updateRoute.isPending}>Dispatch Route</Button>
              </div>
            </div>
          </div>
        );
      })() : null}
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading routes...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load routes')}</div> : null}
      {actionError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{actionError}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Routes" value={routes.length.toLocaleString()} />
          <SummaryCard label="Active" value={summary.active.toLocaleString()} />
          <SummaryCard label="Pending" value={summary.pending.toLocaleString()} />
          <SummaryCard label="Completed" value={summary.completed.toLocaleString()} />
        </div>
        <Button className="shrink-0" onClick={() => setCreateOpen(true)}>+ New Route</Button>
      </div>

      {/* Create Route modal */}
      <Modal
        open={createOpen}
        title="Create Route"
        description="Name the route and assign a driver. Add stops after creation."
        onClose={() => closeCreateModal()}
      >
        <div className="grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Route Name</span>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Back Side" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Driver</span>
            <Combobox
              value={newDriverName}
              onChange={handleNewDriverChange}
              onSelect={(opt) => {
                setNewDriverName(opt.label);
                setNewDriverId(opt.value);
              }}
              options={driverOptions}
              placeholder="Assign driver"
            />
            {linkedNewDriver ? <span className="block text-xs text-muted-foreground">Linked to user account: {linkedNewDriver.email || linkedNewDriver.id}</span> : null}
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Notes</span>
            <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Optional" />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => closeCreateModal()}>Cancel</Button>
            <Button onClick={handleCreateRoute} disabled={createRoute.isPending}>
              {createRoute.isPending ? 'Creating…' : 'Create Route'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Panel */}
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
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Route Name</span>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Driver</span>
                <Combobox
                  value={editDriverName}
                  onChange={handleEditDriverChange}
                  onSelect={(opt) => {
                    setEditDriverName(opt.label);
                    setEditDriverId(opt.value);
                  }}
                  options={driverOptions}
                  placeholder="Assign driver"
                />
                {linkedEditDriver ? <span className="block text-xs text-muted-foreground">Linked to user account: {linkedEditDriver.email || linkedEditDriver.id}</span> : null}
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Notes</span>
                <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </label>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveEdit} disabled={updateRoute.isPending}>{updateRoute.isPending ? 'Saving…' : 'Save Changes'}</Button>
              <Button variant="ghost" onClick={() => switchTab('stops', { routeId: editRoute.id })}>View All Stops</Button>
              <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => handleDeleteRoute(editRoute)}>Delete Route</Button>
            </div>

            {/* Optimize hint */}
            {showOptimizeHint && (
              <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-sm">
                <span>Stops changed — run optimization to find the most efficient order.</span>
                <div className="flex gap-2 ml-4">
                  <Button size="sm" onClick={() => { handleRunOptimize(editRoute.id); setShowOptimizeHint(false); }}>❆ Optimize Now</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowOptimizeHint(false)}>Dismiss</Button>
                </div>
              </div>
            )}

            {/* Add Stop */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">Add Stop</p>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <Combobox
                  value={stopSearch}
                  onChange={(v) => { setStopSearch(v); setSelectedStopCustomerId(''); }}
                  onSelect={(opt) => { setStopSearch(opt.label); setSelectedStopCustomerId(opt.value); }}
                  options={stopOptions}
                  placeholder={stopOptions.length ? 'Search customers or orders…' : 'No customers with saved addresses'}
                />
                <Button onClick={handleAddStopToRoute} disabled={!selectedStopCustomerId || addingStop}>
                  {addingStop ? 'Adding…' : 'Add to Route'}
                </Button>
              </div>
              {selectedStopCustomerId && (() => {
                const opt = stopOptions.find((o) => o.value === selectedStopCustomerId);
                return opt ? <p className="text-xs text-muted-foreground">📍 {opt.sublabel.split(' — Order ')[0]}</p> : null;
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
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleRemoveStop(stop.id)}>Remove</Button>
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
                <p className="text-xs text-muted-foreground">Orders already represented by a stop on this route are hidden so the batch list only shows work that still needs dispatching.</p>
                {batchPendingOrders.length > 0 ? (
                  <>
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
                          {batchPendingOrders.map((order) => (
                            <TableRow key={order.id} className={selectedOrderIds.has(order.id) ? 'bg-primary/5' : 'cursor-pointer hover:bg-muted/40'} onClick={() => toggleOrder(order.id)}>
                              <TableCell><input type="checkbox" readOnly checked={selectedOrderIds.has(order.id)} className="h-4 w-4 cursor-pointer accent-primary" /></TableCell>
                              <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                              <TableCell>{order.customer_name || '-'}</TableCell>
                              <TableCell className={order.customer_address ? '' : 'text-muted-foreground italic'}>{order.customer_address || 'No address on order'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <Button onClick={handleAddOrdersAsStops} disabled={!selectedOrderIds.size || addingStops}>
                      {addingStops ? 'Adding…' : `Add ${selectedOrderIds.size || ''} Stop${selectedOrderIds.size !== 1 ? 's' : ''} to Route`}
                    </Button>
                  </>
                ) : (
                  <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                    Every pending order with a delivery address is already represented on this route.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* AI Driver Assignments */}
      <AIDriverAssignmentsCard
        result={assignmentsResult}
        suggesting={driverAssignments.isPending}
        applying={updateRoute.isPending}
        onSuggest={handleDriverAssignments}
        onApply={handleApplyDriverSuggestion}
      />

      {/* AI Route Optimization Result */}
      {optimizeResult && optimizeRouteId && (
        <RouteOptimizationResultCard
          result={optimizeResult}
          applying={updateRoute.isPending}
          onApply={handleApplyOptimization}
          onDismiss={() => { setOptimizeResult(null); setOptimizeRouteId(null); }}
        />
      )}

      {/* Routes List */}
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Routes</CardTitle>
            <CardDescription>Click Edit to manage stops and assign drivers.</CardDescription>
            <p className="text-sm text-muted-foreground">Dispatch Route should only be used once that outing has actually left the shop. That is what unlocks customer ETA and live tracking.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RouteStatus)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <LiveIndicator updatedAt={dataUpdatedAt} onRefresh={() => { void refetch(); void refetchStops(); }} refreshing={isFetching} />
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
                const isDispatched = status === 'active' || Boolean(route.dispatched_at);
                const canChangeDispatch = status !== 'completed' && status !== 'cancelled';
                const stopCount = resolvedStopIds(route, allStops).length;
                const isEditing = editRoute?.id === route.id;
                const assignedDriver = route.driver || driverDisplayName(driverById.get(String(route.driver_id || '')));
                const hasAssignedDriverId = String(route.driver_id || '').trim().length > 0;
                return (
                  <TableRow key={route.id} className={isEditing ? 'bg-primary/5' : ''}>
                    <TableCell className="font-medium">{route.name || route.id.slice(0, 8)}</TableCell>
                    <TableCell>{assignedDriver || <span className="text-muted-foreground italic">Unassigned</span>}</TableCell>
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
                        {canManageStops && (
                          <Button variant="ghost" size="sm" onClick={() => setAddStopsRoute(route)}>
                            Add Stops
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => switchTab('stops', { routeId: route.id })}>Stops</Button>
                        <Button variant="ghost" size="sm" onClick={() => handleRunOptimize(route.id)} disabled={optimizeRoute.isPending && optimizeRouteId === route.id} title="AI optimize stop order">
                          {optimizeRoute.isPending && optimizeRouteId === route.id ? '…' : '❆ Optimize'}
                        </Button>
                        {!isDispatched && canChangeDispatch && (
                          <Button
                            variant="outline"
                            size="sm"
                            title={hasAssignedDriverId ? 'Mark route as dispatched - driver has left the dock' : 'Assign a driver before dispatching this route'}
                            onClick={() => handleDispatchRoute(route)}
                            disabled={updateRoute.isPending}
                          >
                            Dispatch Route
                          </Button>
                        )}
                        {isDispatched && canChangeDispatch && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            title="Cancel dispatch and pause customer ETA/live tracking"
                            onClick={() => handleCancelDispatch(route)}
                            disabled={updateRoute.isPending}
                          >
                            Cancel Dispatch
                          </Button>
                        )}
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(route.name || '')}`} target="_blank" rel="noreferrer">
                          <Button variant="secondary" size="sm">Map</Button>
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No routes found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {/* Add Stops Modal */}
      {addStopsRoute && (
        <AddStopsModal
          key={addStopsRoute.id}
          route={addStopsRoute}
          pendingOrders={pendingOrders}
          allStops={allStops}
          refetchStops={refetchStops}
          onClose={() => setAddStopsRoute(null)}
          setNotice={setNotice}
          setActionError={setActionError}
        />
      )}
      </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>
  );
}
