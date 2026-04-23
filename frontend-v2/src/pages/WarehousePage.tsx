import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type WarehouseRow = {
  location: string;
  category: string;
  sku: string;
  productName: string;
  qtyOnHand: number;
  qtyReserved: number;
  availableQty: number;
  lastUpdated: string;
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
    const value = record[key];
    if (value !== undefined && value !== null) {
      const parsed = toNumber(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function toRow(raw: unknown): WarehouseRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const sku = pickString(record, ['sku', 'item_number', 'itemNumber', 'productSku', 'product_sku']);
  if (!sku) return null;

  const qtyOnHand = pickNumber(record, ['qtyOnHand', 'qty_on_hand', 'on_hand_qty', 'stock', 'quantity']);
  const qtyReserved = pickNumber(record, ['qtyReserved', 'qty_reserved', 'reserved_qty', 'reserved']);
  const explicitAvailable = pickNumber(record, ['availableQty', 'available_qty', 'available'], Number.NaN);
  const availableQty = Number.isFinite(explicitAvailable) ? explicitAvailable : qtyOnHand - qtyReserved;

  return {
    location: pickString(record, ['location', 'locationName', 'location_name', 'warehouse', 'site'], 'Main'),
    category: pickString(record, ['category', 'productCategory', 'product_category'], 'Uncategorized'),
    sku,
    productName: pickString(record, ['productName', 'product_name', 'description', 'name'], sku),
    qtyOnHand,
    qtyReserved,
    availableQty,
    lastUpdated: pickString(record, ['lastUpdated', 'last_updated', 'updatedAt', 'updated_at']),
  };
}

function parseRows(data: unknown): WarehouseRow[] {
  if (Array.isArray(data)) {
    return data.map(toRow).filter((row): row is WarehouseRow => !!row);
  }

  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  const candidates = [root.rows, root.items, root.data, root.locations, root.inventory];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(toRow).filter((row): row is WarehouseRow => !!row);
    }
  }

  return [];
}

async function loadWarehouseRows() {
  try {
    const data = await fetchWithAuth<unknown>('/api/warehouse');
    return { endpoint: '/api/warehouse', rows: parseRows(data) };
  } catch {
    const data = await fetchWithAuth<unknown>('/api/inventory/locations');
    return { endpoint: '/api/inventory/locations', rows: parseRows(data) };
  }
}

export function WarehousePage() {
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceEndpoint, setSourceEndpoint] = useState('');
  const [locationFilter, setLocationFilter] = useState<'all' | string>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await loadWarehouseRows();
      setRows(response.rows);
      setSourceEndpoint(response.endpoint);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load warehouse inventory'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const locationOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      if (row.location) unique.add(row.location);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const categoryOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      if (row.category) unique.add(row.category);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (locationFilter !== 'all' && row.location !== locationFilter) return false;
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      return true;
    });
  }, [rows, locationFilter, categoryFilter]);

  const summary = useMemo(() => {
    const totalSkus = new Set(rows.map((row) => row.sku)).size;
    const totalUnits = rows.reduce((sum, row) => sum + row.qtyOnHand, 0);
    const lowStockItems = rows.filter((row) => row.availableQty <= 10).length;
    const locationsCount = new Set(rows.map((row) => row.location)).size;
    return { totalSkus, totalUnits, lowStockItems, locationsCount };
  }, [rows]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading warehouse data...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total SKUs" value={summary.totalSkus.toLocaleString()} />
        <SummaryCard label="Total Units" value={summary.totalUnits.toLocaleString()} />
        <SummaryCard label="Low Stock Items" value={summary.lowStockItems.toLocaleString()} />
        <SummaryCard label="Locations Count" value={summary.locationsCount.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Warehouse Inventory</CardTitle>
            <CardDescription>
              Location-level stock visibility from <span className="font-semibold">{sourceEndpoint || '/api/warehouse'}</span>.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
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
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Qty On Hand</TableHead>
                <TableHead>Qty Reserved</TableHead>
                <TableHead>Available Qty</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((row) => {
                  const lowStock = row.availableQty <= 10;
                  return (
                    <TableRow key={`${row.location}-${row.sku}`} className={lowStock ? 'bg-amber-50/70' : undefined}>
                      <TableCell>{row.location}</TableCell>
                      <TableCell className="font-medium">{row.sku}</TableCell>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.qtyOnHand.toLocaleString()}</TableCell>
                      <TableCell>{row.qtyReserved.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {row.availableQty.toLocaleString()}
                          {lowStock ? <Badge variant="warning">Low</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>{row.lastUpdated ? new Date(row.lastUpdated).toLocaleString() : '-'}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No warehouse rows found for the selected filters.
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
