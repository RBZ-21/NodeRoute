import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { LoadingSkeleton } from '../ui/data-state';
import { cn } from '../../lib/utils';
import {
  type Delivery,
  type DriverSummary,
  type RouteRecord,
  useAnalyticsQuery,
  useDeliveriesQuery,
  useDriversQuery,
  useRoutesQuery,
  useStatsQuery,
} from '../../hooks/useDashboard';

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function activeStopsForRoute(route: RouteRecord): string[] {
  const savedStops = Array.isArray(route.stop_ids) ? route.stop_ids.map(String) : [];
  const activeStops = Array.isArray(route.active_stop_ids) ? route.active_stop_ids.map(String) : savedStops;
  const activeSet = new Set(activeStops);
  return savedStops.filter((stopId) => activeSet.has(String(stopId)));
}

export function OperationalSnapshot({ enabled = true }: { enabled?: boolean }) {
  const statsQuery = useStatsQuery(enabled);
  const analyticsQuery = useAnalyticsQuery(enabled);
  const deliveriesQuery = useDeliveriesQuery(enabled);
  const driversQuery = useDriversQuery(enabled);
  const routesQuery = useRoutesQuery(enabled);

  const stats = statsQuery.data ?? null;
  const analytics = analyticsQuery.data ?? null;
  const deliveries: Delivery[] = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data]);
  const drivers: DriverSummary[] = useMemo(() => driversQuery.data ?? [], [driversQuery.data]);
  const routes: RouteRecord[] = useMemo(() => routesQuery.data ?? [], [routesQuery.data]);

  const deliverySummary = stats ?? {
    totalDeliveries: deliveries.length,
    completedToday: deliveries.filter((d) => d.status === 'delivered').length,
    onTimeRate: asNumber(analytics?.onTimeRate, 0),
    activeDrivers: drivers.filter((d) => String(d.status || '').toLowerCase() === 'on-duty').length,
    totalDrivers: drivers.length,
    failed: deliveries.filter((d) => d.status === 'failed').length,
    pendingCount: deliveries.filter((d) => d.status === 'pending').length,
    inTransitCount: deliveries.filter((d) => d.status === 'in-transit').length,
    yesterday: { totalDeliveries: 0, completedToday: 0, onTimeRate: 0, activeDrivers: 0, totalDrivers: drivers.length, failed: 0, pendingCount: 0, inTransitCount: 0 },
  };

  const activeDeliveries = useMemo(
    () => deliveries.filter((d) => d.status === 'pending' || d.status === 'in-transit'),
    [deliveries],
  );

  const activeRoutes = useMemo(
    () =>
      routes
        .map((route) => ({
          ...route,
          activeStopCount: activeStopsForRoute(route).length,
          savedStopCount: Array.isArray(route.stop_ids) ? route.stop_ids.length : 0,
          relatedDeliveries: deliveries.filter((d) => String(d.routeId || '') === String(route.id)),
        }))
        .filter((route) => route.activeStopCount > 0 || route.savedStopCount > 0),
    [routes, deliveries],
  );

  const fleetSummary = useMemo(() => ({
    totalMiles: drivers.reduce((sum, driver) => sum + asNumber(driver.milesToday, 0), 0),
    totalStops: drivers.reduce((sum, driver) => sum + asNumber(driver.totalStopsToday, 0), 0),
    activeVehicles: drivers.filter((driver) => String(driver.status || '').toLowerCase() === 'on-duty').length,
    routesRunning: activeRoutes.filter((route) => route.relatedDeliveries.some((delivery) => delivery.status === 'pending' || delivery.status === 'in-transit')).length,
  }), [drivers, activeRoutes]);

  const isLoading = enabled && (
    statsQuery.isPending || analyticsQuery.isPending || deliveriesQuery.isPending ||
    driversQuery.isPending || routesQuery.isPending
  );

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm">Operational Snapshot</CardTitle>
        <CardDescription>Live service quality, route flow, and stop efficiency.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 pt-0">
        {isLoading ? <LoadingSkeleton rows={2} label="Loading operational snapshot" /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniMetric label="Avg Stop Duration" value={`${analytics?.avgStopTime || '0.0'} min`} />
          <MiniMetric label="Avg Speed" value={`${analytics?.avgSpeed || '0.0'} mph`} />
          <MiniMetric label="Completed Today" value={deliverySummary.completedToday.toLocaleString()} />
          <MiniMetric label="Open Deliveries" value={(deliverySummary.pendingCount + deliverySummary.inTransitCount).toLocaleString()} />
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="text-sm font-semibold text-foreground">Fleet Summary</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SummaryLine label="Fleet miles today" value={`${fleetSummary.totalMiles.toFixed(1)} mi`} />
            <SummaryLine label="Completed stops" value={fleetSummary.totalStops.toLocaleString()} />
            <SummaryLine label="Active vehicles" value={`${fleetSummary.activeVehicles} of ${drivers.length}`} />
            <SummaryLine label="Routes in motion" value={fleetSummary.routesRunning.toLocaleString()} />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <InsightPill label="Pending" value={deliverySummary.pendingCount.toLocaleString()} tone="amber" />
          <InsightPill label="In Transit" value={deliverySummary.inTransitCount.toLocaleString()} tone="blue" />
          <InsightPill label="Door Codes On File" value={String(analytics?.doorBreakdown?.['Door code on file'] || 0)} tone="emerald" />
          <InsightPill label="No Door Code" value={String(analytics?.doorBreakdown?.['No code'] || 0)} tone="slate" />
        </div>
        {activeDeliveries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
            No open delivery movement is reporting right now.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2 text-sm last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function InsightPill({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'blue' | 'slate' }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', insightToneClass(tone))}>
      <div className="text-xs font-semibold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function insightToneClass(tone: 'emerald' | 'amber' | 'blue' | 'slate') {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (tone === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}
