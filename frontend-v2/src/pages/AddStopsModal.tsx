import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  type PendingOrder,
  type RouteRecord,
  type StopRecord,
  useCreateStop,
  useUpdateRoute,
} from '../hooks/useRoutes';
import { normalizedLocationKey } from './routes.helpers';

type Props = {
  route: RouteRecord;
  pendingOrders: PendingOrder[];
  allStops: StopRecord[];
  refetchStops: () => Promise<unknown>;
  onClose: () => void;
  setNotice: (value: string) => void;
  setActionError: (value: string) => void;
};

/**
 * "Add Stops" modal for a single route. Mounted fresh per route selection
 * (via `key={route.id}`), so it owns its own draft state — manual-stop inputs,
 * selected pending orders, and a local working copy of the route's stop ids —
 * and its own create-stop / update-route mutations. The parent only owns the
 * selection (which route the modal targets), keeping route-page churn out of
 * the rest of the page while the modal is open.
 */
export function AddStopsModal({ route, pendingOrders, allStops, refetchStops, onClose, setNotice, setActionError }: Props) {
  const createStop = useCreateStop();
  const updateRoute = useUpdateRoute();

  // Local working copy of stop ids so successive adds accumulate correctly
  // without round-tripping through the parent's selection state.
  const [stopIds, setStopIds] = useState<string[]>(route.active_stop_ids || route.stop_ids || []);

  const [manualStopName, setManualStopName] = useState('');
  const [manualStopAddress, setManualStopAddress] = useState('');
  const [manualStopNotes, setManualStopNotes] = useState('');
  const [addingManual, setAddingManual] = useState(false);

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [addingStops, setAddingStops] = useState(false);

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  }

  async function addManualStop() {
    if (!manualStopAddress.trim()) return;
    setAddingManual(true); setActionError(''); setNotice('');
    try {
      const stop = await createStop.mutateAsync({
        name: manualStopName.trim() || manualStopAddress.trim(),
        address: manualStopAddress.trim(),
        notes: manualStopNotes.trim() || undefined,
      });
      if (stop?.id) {
        const merged = Array.from(new Set([...stopIds, stop.id]));
        await updateRoute.mutateAsync({ id: route.id, patch: { stopIds: merged, activeStopIds: merged } });
        setStopIds(merged);
        setNotice('Stop added to route.');
        setManualStopName(''); setManualStopAddress(''); setManualStopNotes('');
        await refetchStops();
      }
    } catch (err) {
      setActionError(String((err as Error).message || 'Could not add stop'));
    } finally {
      setAddingManual(false);
    }
  }

  async function addOrdersAsStops() {
    if (!selectedOrderIds.size) return;
    setAddingStops(true); setActionError(''); setNotice('');
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
        const merged = Array.from(new Set([...stopIds, ...newStopIds]));
        await updateRoute.mutateAsync({ id: route.id, patch: { stopIds: merged, activeStopIds: merged } });
        setStopIds(merged);
        setNotice(`${newStopIds.length} stop${newStopIds.length > 1 ? 's' : ''} added.${failed.length ? ` Skipped (no address): ${failed.join(', ')}` : ''}`);
        setSelectedOrderIds(new Set());
        await refetchStops();
      } else {
        setActionError(`No stops added. Missing addresses for: ${failed.join(', ')}`);
      }
    } catch (err) {
      setActionError(String((err as Error).message || 'Could not add stops'));
    } finally {
      setAddingStops(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl">
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="space-y-1">
            <CardTitle>Add Stops</CardTitle>
            <CardDescription>{route.name || route.id}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-muted-foreground">Manual Stop</p>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Name</span>
                <Input value={manualStopName} onChange={(e) => setManualStopName(e.target.value)} placeholder="Customer or location" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Address *</span>
                <Input value={manualStopAddress} onChange={(e) => setManualStopAddress(e.target.value)} placeholder="123 Main St" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Notes</span>
                <Input value={manualStopNotes} onChange={(e) => setManualStopNotes(e.target.value)} placeholder="Optional" />
              </label>
            </div>
            <Button onClick={addManualStop} disabled={!manualStopAddress.trim() || addingManual}>
              {addingManual ? 'Adding…' : 'Add Stop'}
            </Button>
          </div>
          <div className="border-t border-border" />
          {pendingOrders.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">From Pending Orders</p>
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
                          <input type="checkbox" readOnly checked={selectedOrderIds.has(order.id)} className="h-4 w-4 cursor-pointer accent-primary" />
                        </TableCell>
                        <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                        <TableCell>{order.customer_name || '-'}</TableCell>
                        <TableCell className={order.customer_address ? '' : 'text-muted-foreground italic'}>
                          {order.customer_address || 'No address'}
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
          ) : (
            <p className="text-sm text-muted-foreground">No pending orders available to add from.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
