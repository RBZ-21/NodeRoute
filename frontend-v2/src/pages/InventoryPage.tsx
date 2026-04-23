import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type InventoryItem = {
  id: string;
  item_number?: string;
  description?: string;
  category?: string;
  on_hand_qty?: number | string;
  cost?: number | string;
  unit?: string;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<InventoryItem[]>('/api/inventory');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load inventory'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const totalSkus = items.length;
    const lowStock = items.filter((item) => asNumber(item.on_hand_qty) > 0 && asNumber(item.on_hand_qty) <= 10).length;
    const outOfStock = items.filter((item) => asNumber(item.on_hand_qty) <= 0).length;
    const inventoryValue = items.reduce((sum, item) => sum + asNumber(item.on_hand_qty) * asNumber(item.cost), 0);
    return { totalSkus, lowStock, outOfStock, inventoryValue };
  }, [items]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading inventory...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="SKUs" value={summary.totalSkus.toLocaleString()} />
        <SummaryCard label="Low Stock" value={summary.lowStock.toLocaleString()} />
        <SummaryCard label="Out Of Stock" value={summary.outOfStock.toLocaleString()} />
        <SummaryCard label="Inventory Value" value={money(summary.inventoryValue)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Inventory Overview</CardTitle>
            <CardDescription>Live stock visibility from existing `/api/inventory` routes.</CardDescription>
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>On Hand</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length ? (
                items.map((item) => {
                  const qty = asNumber(item.on_hand_qty);
                  const status =
                    qty <= 0 ? <Badge variant="warning">Out</Badge> : qty <= 10 ? <Badge variant="secondary">Low</Badge> : <Badge variant="success">Healthy</Badge>;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.item_number || '-'}</TableCell>
                      <TableCell>{item.description || '-'}</TableCell>
                      <TableCell>{item.category || '-'}</TableCell>
                      <TableCell>
                        {qty.toLocaleString()} {item.unit || ''}
                      </TableCell>
                      <TableCell>{money(asNumber(item.cost))}</TableCell>
                      <TableCell>{status}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No inventory rows available.
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
