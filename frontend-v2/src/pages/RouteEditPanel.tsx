import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  type Customer,
  type Driver,
  type PendingOrder,
  type RouteRecord,
  type StopRecord,
  useCreateStop,
  useDeleteRoute,
  useUpdateRoute,
} from '../hooks/useRoutes';
import { driverDisplayName, normalizedLocationKey, resolveDriverSelection } from './routes.helpers';

type DriverOption = { label: string; sublabel: string | undefined; value: string };

type Props = {
  route: RouteRecord;
  drivers: Driver[];
  driverOptions: DriverOption[];
  driverById: Map<string, Driver>;
  customers: Customer[];
  pendingOrders: PendingOrder[];
  allStops: StopRecord[];
  refetchStops: () => Promise<unknown>;
  onClose: () => void;
  onOptimize: (routeId: string) => void;
  onRouteChange: (updated: RouteRecord) => void;
  setNotice: (value: string) => void;
  setActionError: (value: string) => void;
};

/**
 * Route edit panel. Mounted fresh per route selection (via `key={route.id}`),
 * so it owns its own edit form fields, stop-add inputs, batch-order selection,
 * a local working copy of the route's stop ids, and its own
 * create-stop / update-route / delete-route mutations. The parent keeps only
 * the selection (which route is open) for table highlighting and the
 * AI-assignment apply path; `onRouteChange` keeps the parent's snapshot in sync
 * after saves and stop edits, and the driver fields re-sync from the `route`
 * prop when an external change (e.g. an applied AI suggestion) lands.
 */
export function RouteEditPanel({
  route,
  drivers,
  driverOptions,
  driverById,
  customers,
  pendingOrders,
  allStops,
  refetchStops,
  onClose,
  onOptimize,
  onRouteChange,
  setNotice,
  setActionError,
}: Props) {
  const navigate = useNavigate();
  const updateRoute = useUpdateRoute();
  const createStop = useCreateStop();
  const deleteRoute = useDeleteRoute();

  const [editName, setEditName] = useState(route.name || '');
  const [editDriverName, setEditDriverName] = useState(route.driver || driverDisplayName(driverById.get(String(route.driver_id || ''))) || '');
  const [editDriverId, setEditDriverId] = useState(String(route.driver_id || ''));
  const [editNotes, setEditNotes] = useState(route.notes || '');

  // Local working copy of the route's stop ids so successive add/remove edits
  // accumulate correctly without round-tripping through the parent's snapshot.
  const [stopIds, setStopIds] = useState<string[]>(route.active_stop_ids || route.stop_ids || []);

  const [stopSearch, setStopSearch] = useState('');
  const [selectedStopCustomerId, setSelectedStopCustomerId] = useState('');
  const [addingStop, setAddingStop] = useState(false);

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [addingStops, setAddingStops] = useState(false);

  const [showOptimizeHint, setShowOptimizeHint] = useState(false);

  // Reflect external driver changes to the open route (e.g. an applied AI
  // suggestion the parent wrote into its snapshot) without losing in-progress
  // name/notes edits.
  useEffect(() => {
    setEditDriverName(route.driver || driverDisplayName(driverById.get(String(route.driver_id || ''))) || '');
    setEditDriverId(String(route.driver_id || ''));
  }, [route.driver, route.driver_id, driverById]);

  const linkedEditDriver = editDriverId ? driverById.get(editDriverId) : undefined;

  const editRouteStops = useMemo(
    () => stopIds.map((id) => allStops.find((s) => s.id === id)).filter(Boolean) as StopRecord[],
    [stopIds, allStops],
  );

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

  async function patchRouteStops(nextIds: string[]) {
    const dedupedIds = Array.from(new Set(nextIds));
    await updateRoute.mutateAsync({ id: route.id, patch: { stopIds: dedupedIds, activeStopIds: dedupedIds } });
    setStopIds(dedupedIds);
    onRouteChange({ ...route, active_stop_ids: dedupedIds, stop_ids: dedupedIds });
    await refetchStops();
    if (dedupedIds.length > 1) setShowOptimizeHint(true);
  }

  function handleEditDriverChange(value: string) {
    setEditDriverName(value);
    const selectedDriver = driverById.get(editDriverId);
    if (!selectedDriver) {
      setEditDriverId('');
      return;
    }
    const normalizedValue = value.trim().toLowerCase();
    const keepSelected =
      normalizedValue &&
      (
        String(selectedDriver.name || '').trim().toLowerCase() === normalizedValue
        || String(selectedDriver.email || '').trim().toLowerCase() === normalizedValue
      );
    if (!keepSelected) setEditDriverId('');
  }

  function handleSaveEdit() {
    if (!editName.trim()) { setActionError('Route name is required.'); return; }
    const resolvedDriver = resolveDriverSelection(drivers, editDriverName, editDriverId);
    if (!resolvedDriver) {
      setActionError('Choose a driver from the saved user list or clear the route assignment.');
      return;
    }
    setActionError('');
    updateRoute.mutate(
      { id: route.id, patch: { name: editName.trim(), driver: resolvedDriver.driverName, driverId: resolvedDriver.driverId, notes: editNotes.trim() } },
      {
        onSuccess: () => {
          setNotice('Route updated.');
          onRouteChange({ ...route, name: editName.trim(), driver: resolvedDriver.driverName, driver_id: resolvedDriver.driverId, notes: editNotes.trim() });
          setEditDriverName(resolvedDriver.driverName);
          setEditDriverId(String(resolvedDriver.driverId || ''));
        },
        onError: (err) => setActionError(String((err as Error).message || 'Could not update route')),
      }
    );
  }

  function handleDeleteRoute() {
    if (!confirm(`Delete route "${route.name || route.id}"?`)) return;
    setActionError('');
    deleteRoute.mutate(route.id, {
      onSuccess: () => { setNotice('Route deleted.'); onClose(); },
      onError: (err) => setActionError(String((err as Error).message || 'Could not delete route')),
    });
  }

  function handleRemoveStop(stopId: string) {
    patchRouteStops(stopIds.filter((id) => id !== stopId))
      .catch((err) => setActionError(String((err as Error).message || 'Could not remove stop')));
  }

  async function handleAddStopToRoute() {
    if (!selectedStopCustomerId) return;
    setAddingStop(true);
    setActionError('');
    try {
      const opt = stopOptions.find((o) => o.value === selectedStopCustomerId);
      if (!opt) throw new Error('Could not find selected customer');
      const existingStop = allStops.find((s) => normalizedLocationKey(s.name, s.address) === normalizedLocationKey(opt.label, opt.address));
      let stopId: string;
      if (existingStop && !stopIds.includes(existingStop.id)) {
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
      await patchRouteStops([...stopIds, stopId]);
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
    if (!selectedOrderIds.size) return;
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
        if (existingStop && !stopIds.includes(existingStop.id)) { newStopIds.push(existingStop.id); continue; }
        if (existingStop && stopIds.includes(existingStop.id)) continue;
        const stop = await createStop.mutateAsync({ name, address, notes: `Order ${order.order_number || order.id}` });
        if (stop?.id) newStopIds.push(stop.id); else failed.push(name);
      }
      if (newStopIds.length) {
        await patchRouteStops([...stopIds, ...newStopIds]);
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

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  }

  return (
    <Card className="border-primary/40 ring-1 ring-primary/20">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle>Editing: {route.name || route.id}</CardTitle>
          <CardDescription>{editRouteStops.length} stop(s) on this route</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
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
          <Button variant="ghost" onClick={() => navigate(`/stops?routeId=${route.id}`)}>View All Stops</Button>
          <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={handleDeleteRoute}>Delete Route</Button>
        </div>

        {/* Optimize hint */}
        {showOptimizeHint && (
          <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-sm">
            <span>Stops changed — run optimization to find the most efficient order.</span>
            <div className="flex gap-2 ml-4">
              <Button size="sm" onClick={() => { onOptimize(route.id); setShowOptimizeHint(false); }}>❆ Optimize Now</Button>
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
  );
}
