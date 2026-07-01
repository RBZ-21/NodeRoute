import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Package,
  Scale,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { WeightEntryModal } from '../components/dashboard/WeightEntryModal';
import { NegativeStockQty } from '../components/inventory/NegativeStock';
import { LiveIndicator } from '../components/ui/live-indicator';
import { AiInsightBanner } from '../components/ui/ai-insight-banner';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { TableEmptyState } from '../components/ui/data-state';
import { getUserRole, sendWithAuth, type Role } from '../lib/api';
import { cn } from '../lib/utils';
import {
  type Delivery,
  type DriverSummary,
  type OrderRecord,
  type RouteRecord,
  dashboardKeys,
  useDashboardOrdersQuery,
  useDeliveriesQuery,
  useDriversQuery,
  usePurchaseOrdersQuery,
  useRoutesQuery,
  useStatsQuery,
} from '../hooks/useDashboard';
import { useLowStockQuery } from '../hooks/useInventory';

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
  if (diff === 0) return { shortLabel: 'No change', tone: 'neutral' as const };
  const positive = (diff > 0) === higherIsBetter;
  return {
    shortLabel: `${diff > 0 ? '+' : '-'}${Math.abs(diff)}`,
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

type ReceivingExceptionEntry = {
  id: string;
  poNumber: string;
  vendor: string;
  receivedAt: string;
  lineLabel: string;
  varianceLabel: string;
  quantityVariance: number;
  overReceiptQty: number;
};

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = getUserRole() as Role;
  const active = role !== 'driver';
  // Superadmin sees everything an admin sees (plus cross-tenant data).
  const isAdmin = role === 'admin' || role === 'superadmin';

  // ── Queries ───────────────────────────────────────────────────────────────
  const statsQuery         = useStatsQuery(active);
  const deliveriesQuery    = useDeliveriesQuery(active);
  const driversQuery       = useDriversQuery(active);
  const routesQuery        = useRoutesQuery(active);
  const ordersQuery        = useDashboardOrdersQuery(active);
  const purchaseOrdersQuery = usePurchaseOrdersQuery(active && isAdmin);
  const lowStockQuery       = useLowStockQuery(active && (isAdmin || role === 'manager'));

  const stats     = statsQuery.data     ?? null;
  const deliveries: Delivery[]     = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data]);
  const drivers:   DriverSummary[] = useMemo(() => driversQuery.data ?? [], [driversQuery.data]);
  const routes:    RouteRecord[]   = useMemo(() => routesQuery.data ?? [], [routesQuery.data]);
  const orders:    OrderRecord[]   = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const vendorPurchaseOrders       = useMemo(() => purchaseOrdersQuery.data ?? [], [purchaseOrdersQuery.data]);
  const lowStockItems              = useMemo(() => lowStockQuery.data ?? [], [lowStockQuery.data]);

  const isLoading = active && (
    statsQuery.isPending || deliveriesQuery.isPending || driversQuery.isPending ||
    routesQuery.isPending || ordersQuery.isPending
  );

  // First error across all queries — mirrors the original Promise.allSettled behaviour.
  const fetchError = [statsQuery, deliveriesQuery, driversQuery, routesQuery, ordersQuery]
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
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.deliveries });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.drivers });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.routes });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.orders });
    if (isAdmin) void queryClient.invalidateQueries({ queryKey: dashboardKeys.purchaseOrders });
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
    onTimeRate: 0,
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

  const purchasingSnapshot = useMemo(() => ({
    open: vendorPurchaseOrders.filter((po) => String(po.status || '').toLowerCase() === 'open').length,
    backordered: vendorPurchaseOrders.filter((po) => String(po.status || '').toLowerCase() === 'backordered').length,
    spend: vendorPurchaseOrders.reduce((sum, po) => sum + asNumber(po.total_ordered_cost, 0), 0),
  }), [vendorPurchaseOrders]);
  const receivingExceptions = useMemo(() => {
    const entries: ReceivingExceptionEntry[] = [];
    let receiptsWithVariance = 0;
    let shortQty = 0;
    let overQty = 0;

    for (const po of vendorPurchaseOrders) {
      for (const receipt of po.receipts || []) {
        const lines = (receipt.lines || []).filter((line) => {
          const varianceType = String(line.variance_type || '').trim().toLowerCase();
          return (varianceType && varianceType !== 'exact_receipt')
            || asNumber(line.over_receipt_qty) > 0
            || asNumber(line.quantity_variance_qty) !== 0;
        });
        if (!lines.length) continue;
        receiptsWithVariance += 1;
        for (const line of lines) {
          const quantityVariance = asNumber(line.quantity_variance_qty);
          const overReceiptQty = asNumber(line.over_receipt_qty);
          if (quantityVariance < 0) shortQty += Math.abs(quantityVariance);
          if (overReceiptQty > 0) overQty += overReceiptQty;
          entries.push({
            id: `${po.id}:${receipt.id}:${line.line_no}`,
            poNumber: po.po_number || po.id.slice(0, 8),
            vendor: String(po.vendor || po.vendor_name || 'Unassigned Vendor'),
            receivedAt: receipt.received_at || '',
            lineLabel: line.product_name || line.item_number || `Line ${line.line_no}`,
            varianceLabel: String(line.variance_type || 'variance').replace(/_/g, ' '),
            quantityVariance,
            overReceiptQty,
          });
        }
      }
    }

    entries.sort((left, right) => String(right.receivedAt || '').localeCompare(String(left.receivedAt || '')));
    return {
      entries,
      receiptsWithVariance,
      shortQty,
      overQty,
    };
  }, [vendorPurchaseOrders]);

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
      {isLoading ? <PageSkeleton /> : null}
      {displayError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{displayError}</div> : null}

      {/* Weight Entry Modal */}
      {weightModalOpen && (
        <WeightEntryModal
          orders={weightQueueSummary.needsWeights}
          onClose={() => setWeightModalOpen(false)}
          onOrderUpdated={handleOrderUpdated}
        />
      )}

      <AiInsightBanner types={['anomaly', 'reorder', 'collections']} />

      {/* ── Page header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Operations Overview</h1>
          <div className="mt-2.5">
            <LiveIndicator updatedAt={statsQuery.dataUpdatedAt} onRefresh={refreshDashboard} refreshing={statsQuery.isFetching} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/orders')}>Orders Queue</Button>
          <Button variant="outline" onClick={() => navigate('/routes')}>Route Workspace</Button>
          {isAdmin ? <Button onClick={() => navigate('/purchasing')}>Purchasing</Button> : null}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard icon={Truck}          iconTone="muted" label="Total Deliveries" value={deliverySummary.totalDeliveries.toLocaleString()} trend={trendText(deliverySummary.totalDeliveries, deliverySummary.yesterday.totalDeliveries)} />
        <MetricCard icon={Activity}       iconTone="muted" label="On-Time Rate"     value={`${deliverySummary.onTimeRate}%`} valueTone={deliverySummary.onTimeRate >= 90 ? 'emerald' : deliverySummary.onTimeRate >= 75 ? 'amber' : 'rose'} trend={trendText(deliverySummary.onTimeRate, deliverySummary.yesterday.onTimeRate)} />
        <MetricCard icon={Users}          iconTone="muted" label="Active Drivers"   value={`${deliverySummary.activeDrivers} / ${deliverySummary.totalDrivers}`} trend={trendText(deliverySummary.activeDrivers, deliverySummary.yesterday.activeDrivers)} />
        <MetricCard icon={AlertTriangle}  iconTone={deliverySummary.failed > 0 ? 'rose' : 'emerald'} label="Failed Deliveries" value={deliverySummary.failed.toLocaleString()} valueTone={deliverySummary.failed > 0 ? 'rose' : 'emerald'} trend={trendText(deliverySummary.failed, deliverySummary.yesterday.failed, false)} />
        <MetricCard
          icon={Scale}
          iconTone="amber"
          label="Needs Weights"
          value={weightQueueSummary.needsWeights.length.toLocaleString()}
          valueTone={weightQueueSummary.needsWeights.length > 0 ? 'amber' : 'slate'}
          hint="Orders awaiting weight capture"
          onClick={weightQueueSummary.needsWeights.length > 0 ? () => setWeightModalOpen(true) : undefined}
        />
        <MetricCard
          icon={Scale}
          iconTone="emerald"
          label="Weights Entered"
          value={weightQueueSummary.weightsEntered.length.toLocaleString()}
          valueTone={weightQueueSummary.weightsEntered.length > 0 ? 'emerald' : 'slate'}
          hint="Ready to invoice & dispatch"
          onClick={() => navigate('/orders?action=weights-entered')}
        />
      </div>

      {/* ── AI Anomaly Detection ── */}
      {(isAdmin || role === 'manager') && (
        <Card className={cn('overflow-hidden rounded-2xl', anomalies && anomalies.some((a) => a.severity === 'high') && 'border-rose-300 ring-1 ring-rose-200 dark:border-rose-800 dark:ring-rose-900')}>
          <SectionHeader
            icon={Sparkles}
            iconTone="primary"
            title="AI Anomaly Detection"
            description={anomalySummary || 'Scan recent operations for unusual patterns across the last 7 days.'}
            actions={
              <Button size="sm" variant="outline" onClick={() => void runAnomalyDetection()} disabled={anomalyLoading}>
                {anomalyLoading ? 'Scanning…' : anomalies ? 'Re-scan' : 'Scan for Anomalies'}
              </Button>
            }
          />
          {anomalies && (
            <CardContent className="p-5">
              {anomalies.length === 0 ? (
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">No anomalies detected in the last 7 days.</p>
              ) : (
                <div className="space-y-2.5">
                  {anomalies.map((a, i) => (
                    <div key={i} className={cn('rounded-xl border px-4 py-3 text-sm', a.severity === 'high' ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30' : a.severity === 'medium' ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30' : 'border-border bg-muted/30')}>
                      <div className="flex items-center gap-2.5">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', a.severity === 'high' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200' : a.severity === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200' : 'bg-muted text-muted-foreground')}>{a.severity}</span>
                        <span className="font-semibold text-foreground">{a.affected_entity}</span>
                      </div>
                      <p className="mt-1.5 leading-relaxed text-muted-foreground">{a.description}</p>
                      <p className="mt-1 text-xs font-medium text-primary">→ {a.recommended_action}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card className="overflow-hidden rounded-2xl">
          <CardHeader className="flex flex-col gap-3 border-b border-border p-5 md:flex-row md:items-center md:justify-between md:space-y-0">
            <div>
              <CardTitle className="text-[15px]">Active Deliveries</CardTitle>
              <CardDescription className="mt-0.5">Live delivery work that still needs attention from dispatch or drivers.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/routes?tab=deliveries')}>Open Deliveries<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
          </CardHeader>
          <CardContent className="p-0">
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
                  <TableEmptyState
                    colSpan={6}
                    title="No active deliveries right now."
                    description="Once dispatch starts assigning work, live delivery activity will show up here."
                    actionLabel="Open Deliveries"
                    onAction={() => navigate('/routes?tab=deliveries')}
                  />
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl">
          <CardHeader className="flex flex-col gap-3 border-b border-border p-5 md:flex-row md:items-center md:justify-between md:space-y-0">
            <div>
              <CardTitle className="text-[15px]">Active Routes</CardTitle>
              <CardDescription className="mt-0.5">Saved templates with today's active stop selections and assigned drivers.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/routes')}>Open Routes<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
          </CardHeader>
          <CardContent className="space-y-2.5 p-5">
            {activeRoutes.length ? (
              activeRoutes.map((route) => {
                const inMotion = route.relatedDeliveries.filter((d) => d.status === 'pending' || d.status === 'in-transit').length;
                return (
                  <div key={route.id} className="rounded-xl border border-border bg-muted/30 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{route.name || `Route ${route.id.slice(0, 8)}`}</div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">Driver: {route.driver || 'Unassigned'} · {route.activeStopCount} active today · {route.savedStopCount} saved stops</div>
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

      {isAdmin ? (
        <Card className="overflow-hidden rounded-2xl">
          <SectionHeader
            icon={ShoppingCart}
            iconTone="primary"
            title="Purchasing Command Center"
            description="Jump directly into vendor PO creation, receiving, backorders, and procurement oversight."
            actions={
              <Button size="sm" onClick={() => navigate('/purchasing')}><ShoppingCart className="mr-1.5 h-3.5 w-3.5" />Open Purchasing Workspace</Button>
            }
          />
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <MiniMetric label="Open Vendor POs" value={purchasingSnapshot.open.toLocaleString()} />
              <MiniMetric label="Backordered POs" value={purchasingSnapshot.backordered.toLocaleString()} />
              <MiniMetric label="Tracked PO Spend" value={money(purchasingSnapshot.spend)} />
            </div>
            <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
              <div className="rounded-xl border border-border bg-muted/10 p-4">
                <div className="text-sm font-semibold text-foreground">Receiving Exceptions</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Dedicated dashboard view of vendor short receipts and overages without leaving the admin home screen.
                </div>
                <div className="mt-3 grid gap-2">
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    Receipts w/ variance: <strong>{receivingExceptions.receiptsWithVariance}</strong>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    Short qty flagged: <strong>{receivingExceptions.shortQty.toFixed(2)}</strong>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    Over qty flagged: <strong>{receivingExceptions.overQty.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/10 p-4">
                <div className="text-sm font-semibold text-foreground">Recent Receiving Exceptions</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Latest receipt lines that posted outside the exact ordered quantity.
                </div>
                {receivingExceptions.entries.length ? (
                  <div className="mt-3 space-y-2">
                    {receivingExceptions.entries.slice(0, 4).map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <strong>{entry.poNumber}</strong> · {entry.vendor}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {entry.receivedAt ? new Date(entry.receivedAt).toLocaleString() : 'Receipt logged'}
                          </div>
                        </div>
                        <div className="mt-1">
                          {entry.lineLabel}: <span className="capitalize">{entry.varianceLabel}</span>
                          {entry.quantityVariance !== 0 ? ` (${entry.quantityVariance.toFixed(2)})` : ''}
                          {entry.overReceiptQty > 0 ? ` · over by ${entry.overReceiptQty.toFixed(2)}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground">
                    No receiving exceptions have been logged yet. Once vendors short or over-ship receipts, the latest variance activity will appear here.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Inventory Health ── */}
      {(isAdmin || role === 'manager') && (
        <Card className="overflow-hidden rounded-2xl">
          <SectionHeader
            icon={Package}
            iconTone={lowStockItems.length > 0 ? 'rose' : 'emerald'}
            title="Inventory Health"
            description={lowStockItems.length > 0
              ? `${lowStockItems.length} item${lowStockItems.length === 1 ? '' : 's'} below reorder point — review before the next dispatch`
              : 'Live stock levels, low-stock alerts, and open purchase order status.'}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => navigate('/inventory')}>View Inventory<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                <Button size="sm" onClick={() => navigate('/purchasing')}>Open POs</Button>
              </>
            }
          />
          <CardContent className="grid gap-4 p-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="flex flex-col gap-2.5">
              <StatTile label="Low-stock items" sub="At or below reorder point" value={lowStockItems.length.toString()} tone={lowStockItems.length > 0 ? 'rose' : 'emerald'} />
              <StatTile label="Open POs" sub="Awaiting receipt" value={purchasingSnapshot.open.toString()} tone={purchasingSnapshot.open > 0 ? 'amber' : 'slate'} />
              <StatTile label="Open PO Value" sub="Committed spend" value={money(purchasingSnapshot.spend)} tone="slate" />
            </div>
            <div>
              <div className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">Items needing reorder</div>
              {lowStockItems.length > 0 ? (
                <>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {lowStockItems.slice(0, 6).map((item) => (
                      <div key={item.item_number} className="flex items-center justify-between gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 dark:border-rose-900 dark:bg-rose-950/30">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{item.description || item.name || item.item_number}</div>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            On hand: {asNumber(item.on_hand_qty, 0) < 0
                              ? <NegativeStockQty qty={asNumber(item.on_hand_qty, 0)} unit={item.unit || ''} onFix={() => navigate(`/inventory?fix=${encodeURIComponent(item.item_number || '')}`)} />
                              : <><strong className="text-foreground">{asNumber(item.on_hand_qty, 0).toFixed(1)}</strong> {item.unit || ''}</>} · Reorder at: {asNumber(item.reorder_point, 0).toFixed(1)} · Short by: <strong className="text-rose-600 dark:text-rose-300">{item.deficit.toFixed(1)}</strong>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="h-8 shrink-0 px-3 text-xs"
                          onClick={() => navigate(`/purchasing?item=${encodeURIComponent(item.item_number || '')}&qty=${Math.ceil(item.deficit)}`)}
                        >
                          Order
                        </Button>
                      </div>
                    ))}
                  </div>
                  {lowStockItems.length > 6 && (
                    <Button variant="ghost" size="sm" className="mt-2.5 text-xs" onClick={() => navigate('/inventory')}>
                      + {lowStockItems.length - 6} more low-stock items
                    </Button>
                  )}
                </>
              ) : (
                <EmptyBlock title="All stock above reorder points" description="Items that drop to or below their reorder threshold will appear here, ready to reorder in one click." />
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type IconTone = 'muted' | 'emerald' | 'amber' | 'rose' | 'primary';

function iconChipClass(tone: IconTone) {
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400';
  if (tone === 'amber') return 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400';
  if (tone === 'rose') return 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400';
  if (tone === 'primary') return 'bg-primary/10 text-primary';
  return 'bg-muted text-muted-foreground';
}

function MetricCard({ icon: Icon, iconTone = 'muted', label, value, trend, hint, valueTone = 'slate', onClick }: { icon: typeof Truck; iconTone?: IconTone; label: string; value: string; trend?: { shortLabel: string; tone: 'positive' | 'negative' | 'neutral' }; hint?: string; valueTone?: 'slate' | 'emerald' | 'amber' | 'rose'; onClick?: () => void }) {
  const TrendIcon = trend?.tone === 'positive' ? ArrowUpRight : trend?.tone === 'negative' ? ArrowDownRight : null;
  const interactive = typeof onClick === 'function';
  const inner = (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">{label}</span>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', iconChipClass(iconTone))}><Icon className="h-4 w-4" /></span>
      </div>
      <div className={cn('text-[2rem] font-semibold leading-none tracking-tight', valueToneClass(valueTone))}>{value}</div>
      {trend ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className={cn('inline-flex items-center gap-0.5 font-semibold', trendToneClass(trend.tone))}>
            {TrendIcon ? <TrendIcon className="h-3.5 w-3.5" /> : null}{trend.shortLabel}
          </span>
          <span className="text-muted-foreground/70">vs yesterday</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/70">
          <span>{hint}</span>
          {interactive ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" /> : null}
        </div>
      )}
    </div>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-2xl border bg-card text-left text-card-foreground shadow-panel transition-colors hover:border-foreground/20 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inner}
      </button>
    );
  }
  return <Card className="rounded-2xl">{inner}</Card>;
}

function SectionHeader({ icon: Icon, iconTone = 'muted', title, description, actions }: { icon: typeof Truck; iconTone?: IconTone; title: string; description?: string; actions?: ReactNode }) {
  return (
    <CardHeader className="flex flex-col gap-3 space-y-0 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-lg', iconChipClass(iconTone))}><Icon className="h-4 w-4" /></span>
        <div>
          <CardTitle className="text-[15px]">{title}</CardTitle>
          {description ? <CardDescription className="mt-0.5">{description}</CardDescription> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </CardHeader>
  );
}

function StatTile({ label, sub, value, tone }: { label: string; sub: string; value: string; tone: 'slate' | 'emerald' | 'amber' | 'rose' }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
      <div className="min-w-0">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{label}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <div className={cn('text-[1.75rem] font-semibold leading-none tracking-tight', valueToneClass(tone))}>{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3.5">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{label}</div>
      <div className="mt-1.5 text-xl font-semibold text-foreground">{value}</div>
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
