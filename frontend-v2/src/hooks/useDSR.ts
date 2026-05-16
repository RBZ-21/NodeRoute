import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export interface DSROverview {
  order_count: number;
  invoice_count: number;
  revenue: number;
  estimated_cost: number;
  margin: number;
  margin_pct: number;
}

export interface DSRRow {
  label: string;
  order_count: number;
  invoice_count: number;
  qty: number;
  revenue: number;
  estimated_cost: number;
  margin: number;
  margin_pct: number;
}

export interface DSRSalesOverview {
  total_sales: number;
  delivery_sales: number;
  pickup_sales: number;
  unknown_sales: number;
  invoice_count: number;
  order_count: number;
  average_invoice: number;
  item_count: number;
}

export interface OrderStatusCount {
  status: string;
  count: number;
  total: number;
}

export interface DSRDailyOpsOverview {
  fill_rate_pct: number;
  requested_qty: number;
  accepted_qty: number;
  short_qty: number;
  over_receipt_qty: number;
  receipt_count: number;
  vendor_count: number;
  short_receipt_line_count: number;
  short_receipt_po_count: number;
  category_count: number;
  inventory_sku_count: number;
  low_stock_sku_count: number;
  top_customer_count: number;
}

export interface DSRCategorySummaryRow {
  category: string;
  sku_count: number;
  total_on_hand_qty: number;
  estimated_stock_value: number;
  low_stock_sku_count: number;
}

export interface DSRVendorFillRow {
  vendor: string;
  po_count: number;
  receipt_count: number;
  line_count: number;
  requested_qty: number;
  accepted_qty: number;
  short_qty: number;
  over_receipt_qty: number;
  short_receipt_line_count: number;
  fill_rate_pct: number;
}

export interface DSRShortShipRow {
  po_number: string;
  vendor: string;
  product_name: string;
  short_qty: number;
  requested_qty: number;
  accepted_qty: number;
  received_at: string | null;
}

export interface DSRDailyOpsResponse {
  generated_at?: string;
  filters?: { date?: string | null };
  overview: DSRDailyOpsOverview;
  top_customers: DSRRow[];
  on_hand_by_category: DSRCategorySummaryRow[];
  vendor_fill: DSRVendorFillRow[];
  short_ship_lines: DSRShortShipRow[];
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchRollups(start: string, end: string) {
  return fetchWithAuth<{
    overview: DSROverview;
    customer: DSRRow[];
    driver: DSRRow[];
    route: DSRRow[];
    sku: DSRRow[];
  }>(`/api/reporting/rollups?start=${start}&end=${end}`);
}

async function fetchSalesSummary(start: string, end: string) {
  return fetchWithAuth<{ overview: DSRSalesOverview }>(
    `/api/reporting/sales-summary?preset=range&start=${start}&end=${end}`
  );
}

async function fetchOrders(start: string, end: string) {
  return fetchWithAuth<Array<{ status: string; total: number }>>(
    `/api/orders?start=${start}&end=${end}`
  );
}

async function fetchDailyOps(date: string) {
  return fetchWithAuth<DSRDailyOpsResponse>(`/api/reporting/daily-ops?date=${date}`);
}

export function useDSR(dateKey: string) {
  const rollupsQ = useQuery({
    queryKey: ['dsr-rollups', dateKey],
    queryFn: () => fetchRollups(dateKey, dateKey),
    staleTime: 60_000,
  });

  const salesQ = useQuery({
    queryKey: ['dsr-sales', dateKey],
    queryFn: () => fetchSalesSummary(dateKey, dateKey),
    staleTime: 60_000,
  });

  const ordersQ = useQuery({
    queryKey: ['dsr-orders', dateKey],
    queryFn: () => fetchOrders(dateKey, dateKey),
    staleTime: 60_000,
  });

  const dailyOpsQ = useQuery({
    queryKey: ['dsr-daily-ops', dateKey],
    queryFn: () => fetchDailyOps(dateKey),
    staleTime: 60_000,
  });

  const orderStatusCounts: OrderStatusCount[] = (() => {
    const orders = Array.isArray(ordersQ.data) ? ordersQ.data : [];
    const map = new Map<string, { count: number; total: number }>();
    for (const o of orders) {
      const s = o.status || 'unknown';
      const existing = map.get(s) || { count: 0, total: 0 };
      map.set(s, { count: existing.count + 1, total: existing.total + (Number(o.total) || 0) });
    }
    return [...map.entries()]
      .map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.count - a.count);
  })();

  return {
    rollups: rollupsQ.data,
    sales: salesQ.data?.overview,
    dailyOps: dailyOpsQ.data,
    orderStatusCounts,
    isLoading: rollupsQ.isLoading || salesQ.isLoading || ordersQ.isLoading || dailyOpsQ.isLoading,
    isError: rollupsQ.isError || salesQ.isError || dailyOpsQ.isError,
    refetch: () => {
      rollupsQ.refetch();
      salesQ.refetch();
      ordersQ.refetch();
      dailyOpsQ.refetch();
    },
  };
}

export { localDateKey };
