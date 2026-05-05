import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

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

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchRollups(start: string, end: string) {
  return apiFetch<{
    overview: DSROverview;
    customer: DSRRow[];
    driver: DSRRow[];
    route: DSRRow[];
    sku: DSRRow[];
  }>(`/api/reporting/rollups?start=${start}&end=${end}`);
}

async function fetchSalesSummary(start: string, end: string) {
  return apiFetch<{ overview: DSRSalesOverview }>(
    `/api/reporting/sales-summary?preset=range&start=${start}&end=${end}`
  );
}

async function fetchOrders(start: string, end: string) {
  return apiFetch<Array<{ status: string; total: number }>>(
    `/api/orders?start=${start}&end=${end}`
  );
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

  // Compute order status breakdown from orders array
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
    orderStatusCounts,
    isLoading: rollupsQ.isLoading || salesQ.isLoading || ordersQ.isLoading,
    isError: rollupsQ.isError || salesQ.isError,
    refetch: () => {
      rollupsQ.refetch();
      salesQ.refetch();
      ordersQ.refetch();
    },
  };
}

export { localDateKey };
