import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock3,
  MapPinned,
  RefreshCw,
  Scale,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { WeightEntryModal } from '../components/dashboard/WeightEntryModal';
import { getUserRole, sendWithAuth } from '../lib/api';
import { cn } from '../lib/utils';
import {
  type Delivery,
  type DriverSummary,
  type OrderRecord,
  type RouteRecord,
  dashboardKeys,
  useAnalyticsQuery,
  useDashboardOrdersQuery,
  useDeliveriesQuery,
  useDriversQuery,
  usePurchaseOrdersQuery,
  useRoutesQuery,
  useStatsQuery,
} from '../hooks/useDashboard';

type Role = 'admin' | 'manager' | 'driver' | 'unknown';

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function activeStopsForRoute(route: RouteRecord): string[] {
  const savedStops = Array.isArray(route.stop_ids) ? route.stop_ids.map(String) : [];
  const activeStops = Array.isArray(route.active_stop_ids) ? route.active_stop_ids.map(String) : savedStops;
  const activeSet = new Set(activeStops);
  return savedStops.filter((stopId) => activeSet.has(String(stopId)));
}

function trendText(current: number, previous: number, higherIsBetter = true) {
  const diff = current - previous;
  if (diff === 0) return { label: 'No change vs yesterday', tone: 'neutral' as const };
  const positive = (diff > 0) === higherIsBetter;
  return {
    label: `${diff > 0 ? '+' : '-'}${Math.abs(diff)} vs yesterday`,
    tone: positive ? ('positive' as const) : ('negative' as const),
  };
}

function deliveryBadgeVariant(status: string): 'warning' | 'secondary' | 'success' | 'neutral' {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pending') return 'warning';
  if (normalized === 'in-transit') return 'secondary';
  if (normalized === 'delivered') return 'success';
  return 'neutral';
}

function orderHasPendingWeights(order: OrderRecord): boolean {
  return (order.items || []).some((item) => {
    const isWeightManaged = item.is_catch_weight || String(item.unit || '').toLowerCase() === 'lb' || item.requested_weight !== undefined;
    return isWeightManaged && !(asNumber(item.actual_weight) > 0);
  });
}

function orderHasCapturedWeights(order: OrderRecord): boolean {
  const weightManaged = (order.items || []).filter((item) =>
    item.is_catch_weight || String(item.unit || '').toLowerCase() === 'lb' || item.requested_weight !== undefined
  );
  return weightManaged.length > 0 && weightManaged.every((item) => asNumber(item.actual_weight) > 0);
}

function isOpenOrder(order: OrderRecord): boolean {
  const normalized = String(order.status || '').toLowerCase();
  return normalized === 'pending' || normalized === 'in_process' || normalized === 'processed';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = getUserRole() as Role;
  const active = role !== 'driver';

  // ── Queries ───────────────────────────────────────────────────────────────
  const statsQuery         = useStatsQuery(active);
  const analyticsQuery     = useAnalyticsQuery(active);
  const deliveriesQuery    = useDeliveriesQuery(active);
  const driversQuery       = useDriversQuery(active);
  const routesQuery        = useRoutesQuery(active);
  const ordersQuery        = useDashboardOrdersQuery(active);
  const purchaseOrdersQuery = usePurchaseOrdersQuery(active && role === 'admin');

  const stats     = statsQuery.data     ?? null;
  const analytics = analyticsQuery.data ?? null;
  const deliveries: Delivery[]     = deliveriesQuery.data    ?? [];
  const drivers:   DriverSummary[] = driversQuery.data       ?? [];
  const routes:    RouteRecord[]   = routesQuery.data        ?? [];
  const orders:    OrderRecord[]   = ordersQuery.data        ?? [];
  const vendorPurchaseOrders       = purchaseOrdersQuery.data ?? [];

  const isLoading = active && (
    statsQuery.isPending || deliveriesQuery.isPending || driversQuery.isPending ||
    routesQuery.isPending || ordersQuery.isPending
  );

  // First error across all queries — mirrors the original Promise.allSettled behaviour.
  const fetchError = [statsQuery, analyticsQuery, deliveriesQuery, driversQuery, routesQuery, ordersQuery]
    .map((q) => (q.error ? String((q.error as Error).message || '') : ''))
    .find(Boolean) || '';

  // ── Local UI state ────────────────────────────────────────────────────────
  const [weightModalOpen, setWeightModalOpen] = useState(false);

  // AI: Anomaly detection — not server state, kept as direct sendWithAuth
  type Anomaly = { type: string; severity: string; description: string; affected_entity: string; recommended_action: string };
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalySummary, setAnomalySummary] = useState('');
  const [anomalyError, setAnomalyError] = useState('');

  async function runAnomalyDetection() {
    setAnomalyLoading(true);
    setAnomalyError('');
    try {
      type AnomalyResult = { anomalies: Anomaly[]; analysis_period: string; summary: string };
      const result = await sendWithAuth<AnomalyResult>('/api/ai/anomalies', 'POST', {});
      setAnomalies(result.anomalies || []);
      setAnomalySummary(result.summary || '');
    } catch (err) {
      setAnomalyError(String((err as Error).message || 'Anomaly detection failed'));
    } finally {
      setAnomalyLoading(false);
    }
  }

  function refreshDashboard() {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.stats });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.analytics });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.deliveries });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.drivers });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.routes });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.orders });
    if (role === 'admin') void queryClient.invalidateQueries({ queryKey: dashboardKeys.purchaseOrders });
  }

  // Patches the dashboard orders cache after the weight modal saves an order.
  function handleOrderUpdated(updated: OrderRecord) {
    queryClient.setQueryData<OrderRecord[]>(dashboardKeys.orders, (prev) =>
      prev?.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)) ?? prev,
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
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

  const weightQueueSummary = useMemo(() => {
    const openOrders = orders.filter((o) => isOpenOrder(o));
    return {
      needsWeights: openOrders.filter((o) => orderHasPendingWeights(o)),
      weightsEntered: openOrders.filter((o) => orderHasCapturedWeights(o)),
    };
  }, [orders]);

  const activeRoutes = useMemo(
    () =>
      [...routes]
        .map((route) => ({
          ...route,
          activeStopCount: activeStopsForRoute(route).length,
          savedStopCount: Array.isArray(route.stop_ids) ? route.stop_ids.length : 0,
          relatedDeliveries: deliveries.filter((d) => String(d.routeId || '') === String(route.id)),
        }))
        .filter((r) => r.activeStopCount > 0 || r.savedStopCount > 0)
        .sort((a, b) => b.activeStopCount - a.activeStopCount || new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 6),
    [routes, deliveries],
  );

  const activeDeliveries = useMemo(
    () =>
      deliveries
        .filter((d) => d.status === 'pending' || d.status === 'in-transit')
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 8),
    [deliveries],
  );

  const topDrivers = useMemo(() => {
    const ranked = analytics?.driverRankings?.length
      ? analytics.driverRankings
      : drivers.map((d) => ({
          name: d.name,
          stopsPerHour: Number((asNumber(d.totalStopsToday, 0) / 8).toFixed(1)),
          avgStopMinutes: asNumber(d.avgStopMinutes, 0),
          avgSpeedMph: asNumber(d.avgSpeedMph, 0),
          onTimeRate: asNumber(d.onTimeRate, 0),
          milesToday: asNumber(d.milesToday, 0),
        }));
    return [...ranked].sort((a, b) => b.onTimeRate - a.onTimeRate || b.stopsPerHour - a.stopsPerHour).slice(0, 5);
  }, [analytics, drivers]);

  const fleetSummary = useMemo(() => ({
    totalMiles: drivers.reduce((sum, d) => sum + asNumber(d.milesToday, 0), 0),
    totalStops: drivers.reduce((sum, d) => sum + asNumber(d.totalStopsToday, 0), 0),
    activeVehicles: drivers.filter((d) => String(d.status || '').toLowerCase() === 'on-duty').length,
    openDeliveries: activeDeliveries.length,
    routesRunning: activeRoutes.filter((r) => r.relatedDeliveries.some((d) => d.status === 'pending' || d.status === 'in-transit')).length,
  }), [drivers, activeDeliveries, activeRoutes]);

  const purchasingSnapshot = useMemo(() => ({
    open: vendorPurchaseOrders.filter((po) => String(po.status || '').toLowerCase() === 'open').length,
    backordered: vendorPurchaseOrders.filter((po) => String(po.status || '').toLowerCase() === 'backordered').length,
    spend: vendorPurchaseOrders.reduce((sum, po) => sum + asNumber(po.total_ordered_cost, 0), 0),
  }), [vendorPurchaseOrders]);

  if (role === 'driver') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Driver Workspace Lives Separately</CardTitle>
          <CardDescription>The V2 admin dashboard is intended for admin and manager workflows. Driver operations still run through the dedicated driver experience.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/driver" className="inline-flex"><Button>Open Driver Workspace</Button></a>
        </CardContent>
      </Card>
    );
  }

  const displayError = anomalyError || fetchError;

  return (
    <div className="space-y-5">
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading dashboard...</div> : null}
      {displayError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{displayError}</div> : null}

      {/* Weight Entry Modal */}
      {weightModalOpen && (
        <WeightEntryModal
          orders={weightQueueSummary.needsWeights}
          onClose={() => setWeightModalOpen(false)}
          onOrderUpdated={handleOrderUpdated}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={refreshDashboard}><RefreshCw className="mr-2 h-4 w-4" />Refresh Dashboard</Button>
        <Button variant="outline" onClick={() => navigate('/orders')}>Orders Queue</Button>
        <Button variant="outline" onClick={() => navigate('/routes')}>Route Workspace</Button>
        {role === 'admin' ? <Button variant="outline" onClick={() => navigate('/purchasing')}>Purchasing</Button> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Truck}          label="Total Deliveries" value={deliverySummary.totalDeliveries.toLocaleString()} trend={trendText(deliverySummary.totalDeliveries, deliverySummary.yesterday.totalDeliveries)} />
        <MetricCard icon={Activity}       label="On-Time Rate"     value={`${deliverySummary.onTimeRate}%`} valueTone={deliverySummary.onTimeRate >= 90 ? 'emerald' : deliverySummary.onTimeRate >= 75 ? 'amber' : 'rose'} trend={trendText(deliverySummary.onTimeRate, deliverySummary.yesterday.onTimeRate)} />
        <MetricCard icon={Users}          label="Active Drivers"   value={`${deliverySummary.activeDrivers} / ${deliverySummary.totalDrivers}`} trend={trendText(deliverySummary.activeDrivers, deliverySummary.yesterday.activeDrivers)} />
        <MetricCard icon={AlertTriangle}  label="Failed Deliveries" value={deliverySummary.failed.toLocaleString()} valueTone={deliverySummary.failed > 0 ? 'rose' : 'emerald'} trend={trendText(deliverySummary.failed, deliverySummary.yesterday.failed, false)} />
      </div>

      {/* ── AI Anomaly Detection ── */}
      {(role === 'admin' || role === 'manager') && (
        <Card className={anomalies && anomalies.some((a) => a.severity === 'high') ? 'border-red-300 ring-1 ring-red-200' : ''}>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between py-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">✦ AI Anomaly Detection</CardTitle>
              {anomalySummary && <CardDescription>{anomalySummary}</CardDescription>}
            </div>
            <Button size="sm" variant="outline" onClick={() => void runAnomalyDetection()} disabled={anomalyLoading}>
              {anomalyLoading ? 'Scanning…' : anomalies ? 'Re-scan' : 'Scan for Anomalies'}
            </Button>
          </CardHeader>
          {anomalies && (
            <CardContent>
              {anomalies.length === 0 ? (
                <p className="text-sm text-emerald-600">No anomalies detected in the last 7 days.</p>
              ) : (
                <div className="space-y-2">
                  {anomalies.map((a, i) => (
                    <div key={i} className={`rounded-lg border px-4 py-3 text-sm ${a.severity === 'high' ? 'border-red-200 bg-red-50' : a.severity === 'medium' ? 'border-yellow-200 bg-yellow-50' : 'border-border bg-muted/30'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${a.severity === 'high' ? 'bg-red-100 text-red-700' : a.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground'}`}>{a.severity}</span>
                          <span className="font-medium">{a.affected_entity}</span>
                          <p className="mt-1 text-muted-foreground">{a.description}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">→ {a.recommended_action}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Operational Snapshot</CardTitle>
            <CardDescription>Real-time view of service quality, route flow, and stop efficiency.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Driver Leaderboard</CardTitle>
            <CardDescription>Best performers today based on on-time rate and stops per hour.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topDrivers.length ? (
              topDrivers.map((driver, index) => (
                <div key={driver.name} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">#{index + 1} {driver.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{driver.stopsPerHour.toFixed(1)} stops/hr · {driver.avgSpeedMph.toFixed(1)} mph · {driver.avgStopMinutes.toFixed(1)} min avg stop</div>
                    </div>
                    <Badge variant={driver.onTimeRate >= 90 ? 'success' : driver.onTimeRate >= 75 ? 'warning' : 'neutral'}>{driver.onTimeRate.toFixed(1)}%</Badge>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', driver.onTimeRate >= 90 ? 'bg-emerald-500' : driver.onTimeRate >= 75 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${Math.max(6, Math.min(100, driver.onTimeRate))}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyBlock title="No driver performance yet" description="Driver rankings will populate after routes begin logging activity." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weight Entry Queue</CardTitle>
            <CardDescription>Click a block to open the inline weight entry list — enter all weights and print invoices without leaving this screen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {weightQueueSummary.needsWeights.length || weightQueueSummary.weightsEntered.length ? (
              <div className="grid gap-3">
                <QueueCard
                  icon={Scale}
                  title="Orders Needing Weights"
                  count={weightQueueSummary.needsWeights.length}
                  description="Click to open the weight entry list. Enter weights and print invoices right here."
                  tone="amber"
                  onClick={() => setWeightModalOpen(true)}
                />
                <QueueCard
                  icon={Scale}
                  title="Weights Entered"
                  count={weightQueueSummary.weightsEntered.length}
                  description="Open orders whose weight-managed items already have actual weights entered."
                  tone="emerald"
                  onClick={() => navigate('/orders?action=weights-entered')}
                />
              </div>
            ) : (
              <EmptyBlock title="No weight queue yet" description="Open weight-managed orders will appear here once processing starts capturing actual weights." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle>Active Deliveries</CardTitle>
              <CardDescription>Live delivery work that still needs attention from dispatch or drivers.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => navigate('/deliveries')}>Open Deliveries<ArrowRight className="ml-2 h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Driver</TableHead><TableHead>Status</TableHead><TableHead>Door</TableHead><TableHead>Distance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeDeliveries.length ? (
                  activeDeliveries.map((delivery) => (
                    <TableRow key={`${delivery.orderDbId || delivery.orderId}-${delivery.id}`}>
                      <TableCell className="font-medium">{delivery.orderId}</TableCell>
                      <TableCell>{delivery.restaurantName}</TableCell>
                      <TableCell>{delivery.driverName || 'Unassigned'}</TableCell>
                      <TableCell><Badge variant={deliveryBadgeVariant(delivery.status)}>{delivery.status}</Badge></TableCell>
                      <TableCell>{delivery.deliveryDoor || 'No code'}</TableCell>
                      <TableCell>{delivery.distanceMiles != null ? `${delivery.distanceMiles.toFixed(1)} mi` : '—'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={6} className="text-muted-foreground">No active deliveries right now. Once dispatch starts assigning work, live delivery activity will show up here.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle>Active Routes</CardTitle>
              <CardDescription>Saved templates with today's active stop selections and assigned drivers.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => navigate('/routes')}>Open Routes<ArrowRight className="ml-2 h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeRoutes.length ? (
              activeRoutes.map((route) => {
                const inMotion = route.relatedDeliveries.filter((d) => d.status === 'pending' || d.status === 'in-transit').length;
                return (
                  <div key={route.id} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{route.name || `Route ${route.id.slice(0, 8)}`}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Driver: {route.driver || 'Unassigned'} · {route.activeStopCount} active today · {route.savedStopCount} saved stops</div>
                        {route.notes ? <div className="mt-2 text-xs text-muted-foreground">{route.notes}</div> : null}
                      </div>
                      <Badge variant={inMotion > 0 ? 'secondary' : 'neutral'}>{inMotion > 0 ? `${inMotion} open` : 'Staged'}</Badge>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyBlock title="No route templates yet" description="Create routes and choose today's active stops to populate this panel." />
            )}
          </CardContent>
        </Card>
      </div>

      {role === 'admin' ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle>Purchasing Command Center</CardTitle>
              <CardDescription>Jump directly into vendor PO creation, receiving, backorders, and procurement oversight.</CardDescription>
            </div>
            <Button onClick={() => navigate('/purchasing')}><ShoppingCart className="mr-2 h-4 w-4" />Open Purchasing Workspace</Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <MiniMetric label="Open Vendor POs" value={purchasingSnapshot.open.toLocaleString()} />
            <MiniMetric label="Backordered POs" value={purchasingSnapshot.backordered.toLocaleString()} />
            <MiniMetric label="Tracked PO Spend" value={money(purchasingSnapshot.spend)} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, trend, valueTone = 'slate' }: { icon: typeof Truck; label: string; value: string; trend: { label: string; tone: 'positive' | 'negative' | 'neutral' }; valueTone?: 'slate' | 'emerald' | 'amber' | 'rose' }) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription className="text-xs font-semibold uppercase tracking-wide">{label}</CardDescription>
          <div className="rounded-full bg-secondary p-2 text-muted-foreground"><Icon className="h-4 w-4" /></div>
        </div>
        <div className={cn('text-3xl font-semibold', valueToneClass(valueTone))}>{value}</div>
        <div className={cn('text-xs font-medium', trendToneClass(trend.tone))}>{trend.label}</div>
      </CardHeader>
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

function EmptyBlock({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
      <div className="font-semibold text-foreground">{title}</div>
      <div className="mt-1">{description}</div>
    </div>
  );
}

function QueueCard({ icon: Icon, title, count, description, tone, onClick }: { icon: typeof Scale; title: string; count: number; description: string; tone: 'emerald' | 'amber'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-lg border border-border bg-muted/20 p-4 text-left transition-colors hover:bg-muted/35">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn('rounded-md border p-2', tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{description}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={cn('text-2xl font-semibold', tone === 'emerald' ? 'text-emerald-600' : 'text-amber-600')}>{count}</div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Orders</div>
        </div>
      </div>
    </button>
  );
}

function valueToneClass(tone: 'slate' | 'emerald' | 'amber' | 'rose') {
  if (tone === 'emerald') return 'text-emerald-600';
  if (tone === 'amber') return 'text-amber-600';
  if (tone === 'rose') return 'text-rose-600';
  return 'text-foreground';
}

function trendToneClass(tone: 'positive' | 'negative' | 'neutral') {
  if (tone === 'positive') return 'text-emerald-600';
  if (tone === 'negative') return 'text-rose-600';
  return 'text-muted-foreground';
}

function insightToneClass(tone: 'emerald' | 'amber' | 'blue' | 'slate') {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (tone === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}
