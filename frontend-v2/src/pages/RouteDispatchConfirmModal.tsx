import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/overlay-panel';
import type { Driver, RouteRecord, StopRecord } from '../hooks/useRoutes';
import { driverDisplayName } from './routes.helpers';

function resolvedStopIds(route: RouteRecord, allStops: StopRecord[]) {
  const stopMap = new Set(allStops.map((s) => String(s.id)));
  return (route.active_stop_ids || route.stop_ids || []).filter((id) => stopMap.has(String(id)));
}

export function RouteDispatchConfirmModal({
  route,
  allStops,
  driverById,
  updateRoutePending,
  onClose,
  onConfirm,
}: {
  route: RouteRecord;
  allStops: StopRecord[];
  driverById: Map<string, Driver>;
  updateRoutePending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const routeLabel = route.name || route.id.slice(0, 8);
  const driverLabel = route.driver || driverDisplayName(driverById.get(String(route.driver_id || ''))) || 'Unassigned';
  const stopCount = resolvedStopIds(route, allStops).length;

  return (
    <Modal
      open
      title="Dispatch route?"
      description="Customer ETA and live tracking will begin for this route."
      onClose={onClose}
      widthClassName="max-w-md"
    >
      <dl className="grid gap-3 text-sm">
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
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} disabled={updateRoutePending}>Dispatch Route</Button>
      </div>
    </Modal>
  );
}
