import { useQuery } from '@tanstack/react-query';
import { fetchListWithAuth, fetchWithAuth } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DashboardStats = {
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

export type DashboardAnalytics = {
  avgStopTime: string;
  onTimeRate: string;
  avgSpeed: string;
  driverRankings: DriverRanking[];
  doorBreakdown?: Record<string, number>;
};

export type DriverRanking = {
  name: string;
  stopsPerHour: number;
  avgStopMinutes: number;
  avgSpeedMph: number;
  onTimeRate: number;
  milesToday: number;
};

export type Delivery = {
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

export type DriverSummary = {
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

export type RouteRecord = {
  id: string;
  name?: string;
  driver?: string;
  notes?: string;
  stop_ids?: string[];
  active_stop_ids?: string[];
  created_at?: string;
};

export type OrderItem = {
  name?: string;
  description?: string;
  item_number?: string;
  unit?: string;
  is_catch_weight?: boolean;
  actual_weight?: number | string | null;
  requested_weight?: number | string | null;
  price_per_lb?: number | string | null;
  unit_price?: number | string | null;
  notes?: string;
};

export type OrderRecord = {
  id: string;
  customer_id?: string;
  customerId?: string;
  order_number?: string;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  status?: string;
  created_at?: string;
  tax_enabled?: boolean;
  tax_rate?: number | string | null;
  items?: OrderItem[];
};

export type VendorPurchaseOrder = {
  id: string;
  po_number?: string;
  vendor_name?: string;
  vendor?: string;
  status?: string;
  total_ordered_cost?: number | string;
  total_backordered_qty?: number | string;
  line_count?: number | string;
  created_at?: string;
  receipts?: Array<{
    id: string;
    received_at?: string;
    lines?: Array<{
      line_no: number;
      item_number?: string | null;
      product_name?: string;
      variance_type?: string;
      quantity_variance_qty?: number | string;
      over_receipt_qty?: number | string;
    }>;
  }>;
};

// ── Polling cadence ───────────────────────────────────────────────────────────
// The dashboard mounts several live queries. They previously each polled every
// 15s, so the page fired ~5 requests every 15s (~20/min) on top of the Sidebar's
// 30s poll. Polling at 30s halves that load while keeping the dashboard live.
// (TanStack Query only polls a query when the tab is focused.)
//
// TODO(backend): the lower-load fix is a single GET /api/dashboard aggregate
// endpoint backing one query here, replacing these per-resource polls. Tracked
// as the Step 4 backend dependency.
const DASHBOARD_REFETCH_MS = 30_000;
const DASHBOARD_STALE_MS = 20_000;

// ── Query keys ────────────────────────────────────────────────────────────────

export const dashboardKeys = {
  stats:          ['stats']              as const,
  analytics:      ['analytics']          as const,
  deliveries:     ['deliveries']         as const,
  drivers:        ['drivers']            as const,
  routes:         ['routes']             as const,
  orders:         ['dashboard', 'orders'] as const,
  purchaseOrders: ['purchase-orders']    as const,
};

// ── Queries ───────────────────────────────────────────────────────────────────

export function useStatsQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: () => fetchWithAuth<DashboardStats>('/api/stats'),
    staleTime: DASHBOARD_STALE_MS,
    refetchInterval: DASHBOARD_REFETCH_MS,
    enabled,
  });
}

export function useAnalyticsQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.analytics,
    queryFn: () => fetchWithAuth<DashboardAnalytics>('/api/analytics'),
    staleTime: DASHBOARD_STALE_MS,
    enabled,
  });
}

export function useDeliveriesQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.deliveries,
    queryFn: () =>
      fetchListWithAuth<Delivery>('/api/deliveries'),
    staleTime: DASHBOARD_STALE_MS,
    refetchInterval: DASHBOARD_REFETCH_MS,
    enabled,
  });
}

export function useDriversQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.drivers,
    queryFn: () =>
      fetchListWithAuth<DriverSummary>('/api/drivers'),
    staleTime: DASHBOARD_STALE_MS,
    refetchInterval: DASHBOARD_REFETCH_MS,
    enabled,
  });
}

export function useRoutesQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.routes,
    queryFn: () =>
      fetchListWithAuth<RouteRecord>('/api/routes'),
    staleTime: DASHBOARD_STALE_MS,
    refetchInterval: DASHBOARD_REFETCH_MS,
    enabled,
  });
}

// Dashboard orders use a separate key from the Orders page so each page owns
// its own typed slice of the data without cache-key collisions.
export function useDashboardOrdersQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.orders,
    queryFn: () =>
      fetchListWithAuth<OrderRecord>('/api/orders'),
    staleTime: DASHBOARD_STALE_MS,
    refetchInterval: DASHBOARD_REFETCH_MS,
    enabled,
  });
}

export function usePurchaseOrdersQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.purchaseOrders,
    queryFn: () =>
      fetchListWithAuth<VendorPurchaseOrder>('/api/ops/vendor-purchase-orders'),
    staleTime: DASHBOARD_STALE_MS,
    enabled,
  });
}
