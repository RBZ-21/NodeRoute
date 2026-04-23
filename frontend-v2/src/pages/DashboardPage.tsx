import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock3,
  MapPinned,
  RefreshCw,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, getUserRole } from '../lib/api';
import { cn } from '../lib/utils';

type Role = 'admin' | 'manager' | 'driver' | 'unknown';

type DashboardStats = {
  totalDeliveries: number;
  completedToday: number;
  onTimeRate: number;
  activeDrivers: number;
  totalDrivers: number;
  failed: number;
  pendingCount: number;
  inTransitCount: number;
  yesterday: {
    totalDeliveries: number;
    completedToday: number;
    onTimeRate: number;
    activeDrivers: number;
    totalDrivers: number;
    failed: number;
    pendingCount: number;
    inTransitCount: number;
  };
};

type DriverRanking = {
  name: string;
  stopsPerHour: number;
  avgStopMinutes: number;
  avgSpeedMph: number;
  onTimeRate: number;
  milesToday: number;
};

type DashboardAnalytics = {
  avgStopTime: string;
  onTimeRate: string;
  avgSpeed: string;
  driverRankings: DriverRanking[];
  doorBreakdown?: Record<string, number>;
};

type Delivery = {
  id: number;
  orderDbId?: string;
  orderId: string;
  restaurantName: string;
  driverName: string;
  status: string;
  deliveryDoor?: string;
  onTime?: boolean | null;
  address?: string;
  distanceMiles?: number;
  stopDurationMinutes?: number | null;
  routeId?: string | null;
  createdAt?: string;
};

type DriverSummary = {
  id: string;
  name: string;
  status?: string;
  onTimeRate?: number;
  totalStopsToday?: number;
  milesToday?: number;
  avgStopMinutes?: number;
  avgSpeedMph?: number;
  updatedAt?: string | null;
};

type RouteRecord = {
  id: string;
  name?: string;
  driver?: string;
  notes?: string;
  stop_ids?: string[];
  active_stop_ids?: string[];
  created_at?: string;
};

type OrderRecord = {
  id: string;
  order_number?: string;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  status?: string;
  created_at?: string;
};

type VendorPurchaseOrder = {
  id: string;
  po_number?: string;
  vendor_name?: string;
  vendor?: string;
  status?: string;
  total_ordered_cost?: number | string;
  total_backordered_qty?: number | string;
  line_count?: number | string;
  created_at?: string;
};

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function activeStopsForRoute(route: RouteRecord): string[] {
  const savedStops = Array.isArray(route.stop_ids) ? route.stop_ids.map(String) : [];
  const activeStops = Array.isArray(route.active_stop_ids) ? route.active_stop_ids.map(String) : savedStops;
  const activeSet = new Set(activeStops);
  return savedStops.filter((stopId) => activeSet.has(String(stopId)));
}

function trendText(current: number, previous: number, higherIsBetter = true) {
  const diff = current - previous;
  if (diff === 0) {
    return { label: 'No change vs yesterday', tone: 'neutral' as const };
  }

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

function orderBadgeVariant(status: string): 'warning' | 'secondary' | 'success' | 'neutral' {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pending') return 'warning';
  if (normalized === 'in_process' || normalized === 'processed') return 'secondary';
  if (normalized === 'invoiced' || normalized === 'delivered' || normalized === 'sent') return 'success';
  return 'neutral';
}

function driverBadgeVariant(status: string | undefined): 'success' | 'neutral' {
  return String(status || '').toLowerCase() === 'on-duty' ? 'success' : 'neutral';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const role = getUserRole() as Role;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [vendorPurchaseOrders, setVendorPurchaseOrders] = useState<VendorPurchaseOrder[]>([]);

  async function loadDashboard() {
    if (role === 'driver') {
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    const requests = await Promise.allSettled([
      fetchWithAuth<DashboardStats>('/api/stats'),
      fetchWithAuth<DashboardAnalytics>('/api/analytics'),
      fetchWithAuth<Delivery[]>('/api/deliveries'),
      fetchWithAuth<DriverSummary[]>('/api/drivers'),
      fetchWithAuth<RouteRecord[]>('/api/routes'),
      fetchWithAuth<OrderRecord[]>('/api/orders'),
      role === 'admin' ? fetchWithAuth<VendorPurchaseOrder[]>('/api/ops/vendor-purchase-orders') : Promise.resolve([]),
    ]);

    const nextErrors: string[] = [];

    if (requests[0].status === 'fulfilled') setStats(requests[0].value);
    else nextErrors.push(String(requests[0].reason?.message || 'Could not load delivery stats.'));

    if (requests[1].status === 'fulfilled') setAnalytics(requests[1].value);
    else nextErrors.push(String(requests[1].reason?.message || 'Could not load dashboard analytics.'));

    if (requests[2].status === 'fulfilled') setDeliveries(Array.isArray(requests[2].value) ? requests[2].value : []);
    else nextErrors.push(String(requests[2].reason?.message || 'Could not load deliveries.'));

    if (requests[3].status === 'fulfilled') setDrivers(Array.isArray(requests[3].value) ? requests[3].value : []);
    else nextErrors.push(String(requests[3].reason?.message || 'Could not load drivers.'));

    if (requests[4].status === 'fulfilled') setRoutes(Array.isArray(requests[4].value) ? requests[4].value : []);
    else nextErrors.push(String(requests[4].reason?.message || 'Could not load routes.'));

    if (requests[5].status === 'fulfilled') setOrders(Array.isArray(requests[5].value) ? requests[5].value : []);
    else nextErrors.push(String(requests[5].reason?.message || 'Could not load orders.'));

    if (requests[6].status === 'fulfilled') setVendorPurchaseOrders(Array.isArray(requests[6].value) ? requests[6].value : []);
    else if (role === 'admin') nextErrors.push(String(requests[6].reason?.message || 'Could not load purchasing snapshot.'));

    setError(nextErrors[0] || '');
    setLoading(false);
  }

  useEffect(() => {
    void loadDashboard();
  }, [role]);

  const deliverySummary = stats ?? {
    totalDeliveries: deliveries.length,
    completedToday: deliveries.filter((delivery) => delivery.status === 'delivered').length,
    onTimeRate: asNumber(analytics?.onTimeRate, 0),
    activeDrivers: drivers.filter((driver) => String(driver.status || '').toLowerCase() === 'on-duty').length,
    totalDrivers: drivers.length,
    failed: deliveries.filter((delivery) => delivery.status === 'failed').length,
    pendingCount: deliveries.filter((delivery) => delivery.status === 'pending').length,
    inTransitCount: deliveries.filter((delivery) => delivery.status === 'in-transit').length,
    yesterday: {
      totalDeliveries: 0,
      completedToday: 0,
      onTimeRate: 0,
      activeDrivers: 0,
      totalDrivers: drivers.length,
      failed: 0,
      pendingCount: 0,
      inTransitCount: 0,
    },
  };

  const recentOrders = useMemo(
    () =>
      [...orders]
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 6),
    [orders]
  );

  const activeRoutes = useMemo(
    () =>
      [...routes]
        .map((route) => ({
          ...route,
          activeStopCount: activeStopsForRoute(route).length,
          savedStopCount: Array.isArray(route.stop_ids) ? route.stop_ids.length : 0,
          relatedDeliveries: deliveries.filter((delivery) => String(delivery.routeId || '') === String(route.id)),
        }))
        .filter((route) => route.activeStopCount > 0 || route.savedStopCount > 0)
        .sort((a, b) => b.activeStopCount - a.activeStopCount || new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 6),
    [routes, deliveries]
  );

  const activeDeliveries = useMemo(
    () =>
      deliveries
        .filter((delivery) => delivery.status === 'pending' || delivery.status === 'in-transit')
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 8),
    [deliveries]
  );

  const topDrivers = useMemo(() => {
    const ranked = analytics?.driverRankings?.length
      ? analytics.driverRankings
      : drivers.map((driver) => ({
          name: driver.name,
          stopsPerHour: Number((asNumber(driver.totalStopsToday, 0) / 8).toFixed(1)),
          avgStopMinutes: asNumber(driver.avgStopMinutes, 0),
          avgSpeedMph: asNumber(driver.avgSpeedMph, 0),
          onTimeRate: asNumber(driver.onTimeRate, 0),
          milesToday: asNumber(driver.milesToday, 0),
        }));
    return [...ranked]
      .sort((a, b) => b.onTimeRate - a.onTimeRate || b.stopsPerHour - a.stopsPerHour)
      .slice(0, 5);
  }, [analytics, drivers]);

  const fleetSummary = useMemo(() => {
    const totalMiles = drivers.reduce((sum, driver) => sum + asNumber(driver.milesToday, 0), 0);
    const totalStops = drivers.reduce((sum, driver) => sum + asNumber(driver.totalStopsToday, 0), 0);
    const activeVehicles = drivers.filter((driver) => String(driver.status || '').toLowerCase() === 'on-duty').length;
    const openDeliveries = activeDeliveries.length;
    const routesRunning = activeRoutes.filter((route) => route.relatedDeliveries.some((delivery) => delivery.status === 'pending' || delivery.status === 'in-transit')).length;
    return { totalMiles, totalStops, activeVehicles, openDeliveries, routesRunning };
  }, [drivers, activeDeliveries, activeRoutes]);

  const purchasingSnapshot = useMemo(() => {
    const open = vendorPurchaseOrders.filter((po) => String(po.status || '').toLowerCase() === 'open').length;
    const backordered = vendorPurchaseOrders.filter((po) => String(po.status || '').toLowerCase() === 'backordered').length;
    const spend = vendorPurchaseOrders.reduce((sum, po) => sum + asNumber(po.total_ordered_cost, 0), 0);
    return { open, backordered, spend };
  }, [vendorPurchaseOrders]);

  if (role === 'driver') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Driver Workspace Lives Separately</CardTitle>
          <CardDescription>
            The V2 admin dashboard is intended for admin and manager workflows. Driver operations still run through the dedicated driver experience.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/driver" className="inline-flex">
            <Button>Open Driver Workspace</Button>
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading dashboard...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={loadDashboard}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Dashboard
        </Button>
        <Button variant="outline" onClick={() => navigate('/orders')}>
          Orders Queue
        </Button>
        <Button variant="outline" onClick={() => navigate('/routes')}>
          Route Workspace
        </Button>
        {role === 'admin' ? (
          <Button variant="outline" onClick={() => navigate('/purchasing')}>
            Purchasing
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Truck}
          label="Total Deliveries"
          value={deliverySummary.totalDeliveries.toLocaleString()}
          trend={trendText(deliverySummary.totalDeliveries, deliverySummary.yesterday.totalDeliveries)}
        />
        <MetricCard
          icon={Activity}
          label="On-Time Rate"
          value={`${deliverySummary.onTimeRate}%`}
          valueTone={deliverySummary.onTimeRate >= 90 ? 'emerald' : deliverySummary.onTimeRate >= 75 ? 'amber' : 'rose'}
          trend={trendText(deliverySummary.onTimeRate, deliverySummary.yesterday.onTimeRate)}
        />
        <MetricCard
          icon={Users}
          label="Active Drivers"
          value={`${deliverySummary.activeDrivers} / ${deliverySummary.totalDrivers}`}
          trend={trendText(deliverySummary.activeDrivers, deliverySummary.yesterday.activeDrivers)}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Failed Deliveries"
          value={deliverySummary.failed.toLocaleString()}
          valueTone={deliverySummary.failed > 0 ? 'rose' : 'emerald'}
          trend={trendText(deliverySummary.failed, deliverySummary.yesterday.failed, false)}
        />
      </div>

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
              <InsightPill
                label="Door Codes On File"
                value={String(analytics?.doorBreakdown?.['Door code on file'] || 0)}
                tone="emerald"
              />
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
                      <div className="text-sm font-semibold text-foreground">
                        #{index + 1} {driver.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {driver.stopsPerHour.toFixed(1)} stops/hr · {driver.avgSpeedMph.toFixed(1)} mph · {driver.avgStopMinutes.toFixed(1)} min avg stop
                      </div>
                    </div>
                    <Badge variant={driver.onTimeRate >= 90 ? 'success' : driver.onTimeRate >= 75 ? 'warning' : 'neutral'}>
                      {driver.onTimeRate.toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        driver.onTimeRate >= 90 ? 'bg-emerald-500' : driver.onTimeRate >= 75 ? 'bg-amber-500' : 'bg-rose-500'
                      )}
                      style={{ width: `${Math.max(6, Math.min(100, driver.onTimeRate))}%` }}
                    />
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
            <CardTitle>Recent Orders</CardTitle>
            <CardDescription>Latest customer orders entering the operation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentOrders.length ? (
              recentOrders.map((order) => (
                <div key={order.id} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{order.order_number || order.id.slice(0, 8)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{order.customer_name || order.customer_email || 'Unnamed customer'}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(order.created_at)}</div>
                    </div>
                    <Badge variant={orderBadgeVariant(order.status || '')}>{String(order.status || 'unknown').replace('_', ' ')}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <EmptyBlock title="No orders yet" description="Recent orders will appear here once the intake queue starts filling." />
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
            <Button variant="outline" onClick={() => navigate('/deliveries')}>
              Open Deliveries
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Door</TableHead>
                  <TableHead>Distance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeDeliveries.length ? (
                  activeDeliveries.map((delivery) => (
                    <TableRow key={`${delivery.orderDbId || delivery.orderId}-${delivery.id}`}>
                      <TableCell className="font-medium">{delivery.orderId}</TableCell>
                      <TableCell>{delivery.restaurantName}</TableCell>
                      <TableCell>{delivery.driverName || 'Unassigned'}</TableCell>
                      <TableCell>
                        <Badge variant={deliveryBadgeVariant(delivery.status)}>{delivery.status}</Badge>
                      </TableCell>
                      <TableCell>{delivery.deliveryDoor || 'No code'}</TableCell>
                      <TableCell>{delivery.distanceMiles != null ? `${delivery.distanceMiles.toFixed(1)} mi` : '—'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No active deliveries right now. Once dispatch starts assigning work, live delivery activity will show up here.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle>Active Routes</CardTitle>
              <CardDescription>Saved templates with today’s active stop selections and assigned drivers.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => navigate('/routes')}>
              Open Routes
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeRoutes.length ? (
              activeRoutes.map((route) => {
                const inMotion = route.relatedDeliveries.filter((delivery) => delivery.status === 'pending' || delivery.status === 'in-transit').length;
                return (
                  <div key={route.id} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{route.name || `Route ${route.id.slice(0, 8)}`}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Driver: {route.driver || 'Unassigned'} · {route.activeStopCount} active today · {route.savedStopCount} saved stops
                        </div>
                        {route.notes ? <div className="mt-2 text-xs text-muted-foreground">{route.notes}</div> : null}
                      </div>
                      <Badge variant={inMotion > 0 ? 'secondary' : 'neutral'}>{inMotion > 0 ? `${inMotion} open` : 'Staged'}</Badge>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyBlock title="No route templates yet" description="Create routes and choose today’s active stops to populate this panel." />
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
            <Button onClick={() => navigate('/purchasing')}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Open Purchasing Workspace
            </Button>
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

function MetricCard({
  icon: Icon,
  label,
  value,
  trend,
  valueTone = 'slate',
}: {
  icon: typeof Truck;
  label: string;
  value: string;
  trend: { label: string; tone: 'positive' | 'negative' | 'neutral' };
  valueTone?: 'slate' | 'emerald' | 'amber' | 'rose';
}) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription className="text-xs font-semibold uppercase tracking-wide">{label}</CardDescription>
          <div className="rounded-full bg-secondary p-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
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

function InsightPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'amber' | 'blue' | 'slate';
}) {
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
