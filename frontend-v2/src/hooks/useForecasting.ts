import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export type ForecastRow = {
  product: string;
  category: string;
  location: string;
  currentStock: number;
  avgWeeklyDemand: number;
  weeksOfSupply: number;
  reorderRecommended: 'yes' | 'no';
};

export type ForecastSummary = {
  projectedRevenue30d: number;
  projectedOrders: number;
  topForecastedProduct: string;
  inventoryRiskItems: number;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function pickNumber(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return fallback;
}

function toRow(raw: unknown): ForecastRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const product = pickString(r, ['product_name', 'product', 'productName', 'item', 'item_name', 'description']);
  if (!product) return null;
  const currentStock = pickNumber(r, ['currentStock', 'current_stock', 'stock', 'on_hand_qty', 'inventory']);
  const periodDemand = pickNumber(r, ['predicted_demand_units', 'predictedDemandUnits']);
  const periodDays = toNumber(r['forecast_period_days'] ?? r['forecastPeriodDays']) || 14;
  const inferredWeekly = periodDays > 0 ? (periodDemand / periodDays) * 7 : 0;
  const avgWeeklyDemand = pickNumber(r, ['avgWeeklyDemand', 'avg_weekly_demand', 'weeklyDemand', 'weekly_demand', 'demand'], inferredWeekly);
  const explicitWeeks = pickNumber(r, ['weeksOfSupply', 'weeks_of_supply'], Number.NaN);
  const weeksOfSupply = Number.isFinite(explicitWeeks) ? explicitWeeks : avgWeeklyDemand > 0 ? currentStock / avgWeeklyDemand : 0;
  const rawReorder = pickString(r, ['reorderRecommended', 'reorder_recommended', 'reorder', 'recommend_reorder']).toLowerCase();
  const reorderFromBoolean = typeof r.reorderRecommended === 'boolean' ? r.reorderRecommended : typeof r.reorder_recommended === 'boolean' ? r.reorder_recommended : undefined;
  const reorderRecommended: 'yes' | 'no' =
    rawReorder === 'yes' || rawReorder === 'true' || reorderFromBoolean === true ? 'yes'
    : rawReorder === 'no' || rawReorder === 'false' || reorderFromBoolean === false ? 'no'
    : weeksOfSupply > 0 && weeksOfSupply < 2 ? 'yes' : 'no';
  return {
    product,
    category: pickString(r, ['category', 'productCategory', 'product_category'], 'Uncategorized'),
    location: pickString(r, ['location', 'warehouse', 'site', 'depot'], 'All Locations'),
    currentStock, avgWeeklyDemand, weeksOfSupply, reorderRecommended,
  };
}

export function parseRows(data: unknown): ForecastRow[] {
  if (Array.isArray(data)) return data.map(toRow).filter((r): r is ForecastRow => !!r);
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const candidates = [
    record.items, record.rows, record.data, record.forecast,
    record.products, record.forecastRows, record.forecast_rows,
    (record.forecast as Record<string, unknown> | undefined)?.items,
    (record.forecast as Record<string, unknown> | undefined)?.rows,
    (record.forecast as Record<string, unknown> | undefined)?.products,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.map(toRow).filter((r): r is ForecastRow => !!r);
  }
  return [];
}

export function parseSummary(data: unknown, rows: ForecastRow[]): ForecastSummary {
  const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const summaryObj =
    (root.summary && typeof root.summary === 'object' ? root.summary as Record<string, unknown> : null) ||
    (root.overview && typeof root.overview === 'object' ? root.overview as Record<string, unknown> : null) ||
    (root.forecast && typeof root.forecast === 'object' ? root.forecast as Record<string, unknown> : null);
  const projectedRevenue30d =
    (summaryObj ? pickNumber(summaryObj, ['projectedRevenue30d', 'projected_revenue_30d', 'projectedRevenue', 'projected_revenue']) : 0) ||
    pickNumber(root, ['projectedRevenue30d', 'projected_revenue_30d']);
  const projectedOrders =
    (summaryObj ? pickNumber(summaryObj, ['projectedOrders', 'projected_orders', 'orders']) : 0) ||
    pickNumber(root, ['projectedOrders', 'projected_orders']);
  const topForecastedProduct =
    (summaryObj ? pickString(summaryObj, ['topForecastedProduct', 'top_forecasted_product', 'topProduct', 'top_product']) : '') ||
    pickString(root, ['topForecastedProduct', 'top_forecasted_product']) ||
    (rows[0]?.product || '-');
  const inventoryRiskItems =
    (summaryObj ? pickNumber(summaryObj, ['inventoryRiskItems', 'inventory_risk_items', 'riskItems', 'risk_items']) : 0) ||
    pickNumber(root, ['inventoryRiskItems', 'inventory_risk_items']) ||
    rows.filter((r) => r.reorderRecommended === 'yes').length;
  return { projectedRevenue30d, projectedOrders, topForecastedProduct, inventoryRiskItems };
}

async function fetchForecast(): Promise<{ endpoint: string; data: unknown }> {
  try {
    const data = await fetchWithAuth<unknown>('/api/forecast/inventory');
    return { endpoint: '/api/forecast/inventory', data };
  } catch {
    const data = await fetchWithAuth<unknown>('/api/forecast/orders');
    return { endpoint: '/api/forecast/orders', data };
  }
}

export function useForecasting() {
  return useQuery({
    queryKey: ['forecasting'],
    queryFn: fetchForecast,
    staleTime: 30_000,
  });
}
