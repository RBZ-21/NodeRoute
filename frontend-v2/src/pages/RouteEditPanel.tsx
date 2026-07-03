import type { Dispatch, SetStateAction } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Combobox, type ComboboxOption } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import type { Driver, PendingOrder, RouteRecord, StopRecord } from '../hooks/useRoutes';

export function RouteEditPanel({
  editRoute,
  editRouteStops,
  onClose,
  editName,
  setEditName,
  editDriverName,
  setEditDriverName,
  onEditDriverChange,
  setEditDriverId,
  driverOptions,
  linkedEditDriver,
  editNotes,
  setEditNotes,
  onSaveEdit,
  updateRoutePending,
  onViewAllStops,
  onDeleteRoute,
  showOptimizeHint,
  setShowOptimizeHint,
  onRunOptimize,
  stopSearch,
  setStopSearch,
  setSelectedStopCustomerId,
  selectedStopCustomerId,
  stopOptions,
  onAddStopToRoute,
  addingStop,
  onRemoveStop,
  pendingOrders,
  batchPendingOrders,
  selectedOrderIds,
  onToggleOrder,
  onAddOrdersAsStops,
  addingStops,
}: {
  editRoute: RouteRecord;
  editRouteStops: StopRecord[];
  onClose: () => void;
  editName: string;
  setEditName: Dispatch<SetStateAction<string>>;
  editDriverName: string;
  setEditDriverName: Dispatch<SetStateAction<string>>;
  onEditDriverChange: (value: string) => void;
  setEditDriverId: Dispatch<SetStateAction<string>>;
  driverOptions: ComboboxOption[];
  linkedEditDriver: Driver | undefined;
  editNotes: string;
  setEditNotes: Dispatch<SetStateAction<string>>;
  onSaveEdit: () => void;
  updateRoutePending: boolean;
  onViewAllStops: (routeId: string) => void;
  onDeleteRoute: (route: RouteRecord) => void;
  showOptimizeHint: boolean;
  setShowOptimizeHint: Dispatch<SetStateAction<boolean>>;
  onRunOptimize: (routeId: string) => void;
  stopSearch: string;
  setStopSearch: Dispatch<SetStateAction<string>>;
  setSelectedStopCustomerId: Dispatch<SetStateAction<string>>;
  selectedStopCustomerId: string;
  stopOptions: ComboboxOption[];
  onAddStopToRoute: () => void;
  addingStop: boolean;
  onRemoveStop: (stopId: string) => void;
  pendingOrders: PendingOrder[];
  batchPendingOrders: PendingOrder[];
  selectedOrderIds: Set<string>;
  onToggleOrder: (orderId: string) => void;
  onAddOrdersAsStops: () => void;
  addingStops: boolean;
}) {
  return (
    <Card className="border-primary/40 ring-1 ring-primary/20">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle>Editing: {editRoute.name || editRoute.id}</CardTitle>
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
              onChange={onEditDriverChange}
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
          <Button onClick={onSaveEdit} disabled={updateRoutePending}>{updateRoutePending ? 'Saving…' : 'Save Changes'}</Button>
          <Button variant="ghost" onClick={() => onViewAllStops(editRoute.id)}>View All Stops</Button>
          <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => onDeleteRoute(editRoute)}>Delete Route</Button>
        </div>

        {showOptimizeHint && (
          <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-sm">
            <span>Stops changed — run optimization to find the most efficient order.</span>
            <div className="flex gap-2 ml-4">
              <Button size="sm" onClick={() => { onRunOptimize(editRoute.id); setShowOptimizeHint(false); }}>❆ Optimize Now</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowOptimizeHint(false)}>Dismiss</Button>
            </div>
          </div>
        )}

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
            <Button onClick={onAddStopToRoute} disabled={!selectedStopCustomerId || addingStop}>
              {addingStop ? 'Adding…' : 'Add to Route'}
            </Button>
          </div>
          {selectedStopCustomerId && (() => {
            const opt = stopOptions.find((o) => o.value === selectedStopCustomerId);
            return opt ? <p className="text-xs text-muted-foreground">📍 {(opt.sublabel || '').split(' — Order ')[0]}</p> : null;
          })()}
        </div>

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
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onRemoveStop(stop.id)}>Remove</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

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
                        <TableRow key={order.id} className={selectedOrderIds.has(order.id) ? 'bg-primary/5' : 'cursor-pointer hover:bg-muted/40'} onClick={() => onToggleOrder(order.id)}>
                          <TableCell><input type="checkbox" readOnly checked={selectedOrderIds.has(order.id)} className="h-4 w-4 cursor-pointer accent-primary" /></TableCell>
                          <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                          <TableCell>{order.customer_name || '-'}</TableCell>
                          <TableCell className={order.customer_address ? '' : 'text-muted-foreground italic'}>{order.customer_address || 'No address on order'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button onClick={onAddOrdersAsStops} disabled={!selectedOrderIds.size || addingStops}>
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
