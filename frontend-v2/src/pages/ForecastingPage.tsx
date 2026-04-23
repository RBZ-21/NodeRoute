import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type ForecastRow = {
  product: string;
  category: string;
  location: string;
  currentStock: number;
  avgWeeklyDemand: number;
  weeksOfSupply: number;
  reorderRecommended: 'yes' | 'no';
};

type ForecastSummary = {
  projectedRevenue30d: number;
  projectedOrders: number;
  topForecastedProduct: string;
  inventoryRiskItems: number;
};

const reorderColors = {
  yes: 'red',
  no: 'green',
} as const;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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
  const record = raw as Record<string, unknown>;

  const product = pickString(record, ['product', 'productName', 'product_name', 'item', 'item_name', 'description']);
  if (!product) return null;

  const currentStock = pickNumber(record, ['currentStock', 'current_stock', 'stock', 'on_hand_qty', 'inventory']);
  const avgWeeklyDemand = pickNumber(record, ['avgWeeklyDemand', 'avg_weekly_demand', 'weeklyDemand', 'weekly_demand', 'demand']);
  const explicitWeeks = pickNumber(record, ['weeksOfSupply', 'weeks_of_supply'], Number.NaN);
  const weeksOfSupply = Number.isFinite(explicitWeeks) ? explicitWeeks : avgWeeklyDemand > 0 ? currentStock / avgWeeklyDemand : 0;

  const rawReorder = pickString(record, ['reorderRecommended', 'reorder_recommended', 'reorder', 'recommend_reorder']).toLowerCase();
  const reorderFromBoolean =
    typeof record.reorderRecommended === 'boolean'
      ? record.reorderRecommended
      : typeof record.reorder_recommended === 'boolean'
        ? record.reorder_recommended
        : undefined;

  const reorderRecommended: 'yes' | 'no' =
    rawReorder === 'yes' || rawReorder === 'true' || reorderFromBoolean === true
      ? 'yes'
      : rawReorder === 'no' || rawReorder === 'false' || reorderFromBoolean === false
        ? 'no'
        : weeksOfSupply > 0 && weeksOfSupply < 2
          ? 'yes'
          : 'no';

  return {
    product,
    category: pickString(record, ['category', 'productCategory', 'product_category'], 'Uncategorized'),
    location: pickString(record, ['location', 'warehouse', 'site', 'depot'], 'All Locations'),
    currentStock,
    avgWeeklyDemand,
    weeksOfSupply,
    reorderRecommended,
  };
}

function parseRows(data: unknown): ForecastRow[] {
  if (Array.isArray(data)) {
    return data.map(toRow).filter((row): row is ForecastRow => !!row);
  }

  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;

  const candidates = [
    record.items,
    record.rows,
    record.data,
    record.forecast,
    record.products,
    record.forecastRows,
    record.forecast_rows,
    (record.forecast as Record<string, unknown> | undefined)?.items,
    (record.forecast as Record<string, unknown> | undefined)?.rows,
    (record.forecast as Record<string, unknown> | undefined)?.products,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(toRow).filter((row): row is ForecastRow => !!row);
    }
  }

  return [];
}

function parseSummary(data: unknown, rows: ForecastRow[]): ForecastSummary {
  const root = (data && typeof data === 'object' ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const summaryObj =
    (root.summary && typeof root.summary === 'object' ? (root.summary as Record<string, unknown>) : null) ||
    (root.overview && typeof root.overview === 'object' ? (root.overview as Record<string, unknown>) : null) ||
    (root.forecast && typeof root.forecast === 'object' ? (root.forecast as Record<string, unknown>) : null);

  const projectedRevenue30d =
    (summaryObj ? pickNumber(summaryObj, ['projectedRevenue30d', 'projected_revenue_30d', 'projectedRevenue', 'projected_revenue']) : 0) ||
    pickNumber(root, ['projectedRevenue30d', 'projected_revenue_30d', 'projectedRevenue', 'projected_revenue']);

  const projectedOrders =
    (summaryObj ? pickNumber(summaryObj, ['projectedOrders', 'projected_orders', 'orders']) : 0) ||
    pickNumber(root, ['projectedOrders', 'projected_orders']);

  const topForecastedProduct =
    (summaryObj ? pickString(summaryObj, ['topForecastedProduct', 'top_forecasted_product', 'topProduct', 'top_product']) : '') ||
    pickString(root, ['topForecastedProduct', 'top_forecasted_product', 'topProduct', 'top_product']) ||
    (rows[0]?.product || '-');

  const inventoryRiskItems =
    (summaryObj ? pickNumber(summaryObj, ['inventoryRiskItems', 'inventory_risk_items', 'riskItems', 'risk_items']) : 0) ||
    pickNumber(root, ['inventoryRiskItems', 'inventory_risk_items']) ||
    rows.filter((row) => row.reorderRecommended === 'yes').length;

  return {
    projectedRevenue30d,
    projectedOrders,
    topForecastedProduct,
    inventoryRiskItems,
  };
}

async function loadForecastData() {
  try {
    const data = await fetchWithAuth<unknown>('/api/forecast');
    return { endpoint: '/api/forecast', data };
  } catch (firstError) {
    const data = await fetchWithAuth<unknown>('/api/analytics/forecast');
    return { endpoint: '/api/analytics/forecast', data, firstError };
  }
}

export function ForecastingPage() {
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [summary, setSummary] = useState<ForecastSummary>({
    projectedRevenue30d: 0,
    projectedOrders: 0,
    topForecastedProduct: '-',
    inventoryRiskItems: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | string>('all');
  const [sourceEndpoint, setSourceEndpoint] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { endpoint, data } = await loadForecastData();
      const parsedRows = parseRows(data);
      const parsedSummary = parseSummary(data, parsedRows);
      setRows(parsedRows);
      setSummary(parsedSummary);
      setSourceEndpoint(endpoint);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load forecast data'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const categoryOptions = useMemo(() => {
    const options = new Set<string>();
    for (const row of rows) {
      if (row.category) options.add(row.category);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const locationOptions = useMemo(() => {
    const options = new Set<string>();
    for (const row of rows) {
      if (row.location) options.add(row.location);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (locationFilter !== 'all' && row.location !== locationFilter) return false;
      return true;
    });
  }, [rows, categoryFilter, locationFilter]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading forecasting data...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Projected Revenue (Next 30 Days)" value={asMoney(summary.projectedRevenue30d)} />
        <SummaryCard label="Projected Orders" value={summary.projectedOrders.toLocaleString()} />
        <SummaryCard label="Top Forecasted Product" value={summary.topForecastedProduct || '-'} />
        <SummaryCard label="Inventory Risk Items" value={summary.inventoryRiskItems.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Forecast Filters</CardTitle>
            <CardDescription>
              Product forecast from <span className="font-semibold">{sourceEndpoint || '/api/forecast'}</span>.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location</span>
              <select
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Locations</option>
                {locationOptions.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forecast Inventory Table</CardTitle>
          <CardDescription>Demand-based supply view to guide reorder planning and office ops decisions.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Avg Weekly Demand</TableHead>
                <TableHead>Weeks of Supply</TableHead>
                <TableHead>Reorder Recommended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((row) => (
                  <TableRow key={`${row.product}-${row.category}-${row.location}`}>
                    <TableCell className="font-medium">
                      <div>{row.product}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.category} · {row.location}
                      </div>
                    </TableCell>
                    <TableCell>{row.currentStock.toLocaleString()}</TableCell>
                    <TableCell>{row.avgWeeklyDemand.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>{row.weeksOfSupply.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.reorderRecommended} colorMap={reorderColors} labelMap={{ yes: 'Yes', no: 'No' }} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No forecast rows found for the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
