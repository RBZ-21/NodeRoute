import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

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
  const [notice, setNotice] = useState('');
  const [selectedItemNumber, setSelectedItemNumber] = useState('');
  const [restockQty, setRestockQty] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<InventoryItem[]>('/api/inventory');
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      if (!selectedItemNumber && rows.length) {
        setSelectedItemNumber(rows[0].item_number || '');
      }
    } catch (err) {
      setError(String((err as Error).message || 'Could not load inventory'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.item_number, item.description, item.category]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle))
    );
  }, [items, search]);

  const summary = useMemo(() => {
    const totalSkus = items.length;
    const lowStock = items.filter((item) => asNumber(item.on_hand_qty) > 0 && asNumber(item.on_hand_qty) <= 10).length;
    const outOfStock = items.filter((item) => asNumber(item.on_hand_qty) <= 0).length;
    const inventoryValue = items.reduce((sum, item) => sum + asNumber(item.on_hand_qty) * asNumber(item.cost), 0);
    return { totalSkus, lowStock, outOfStock, inventoryValue };
  }, [items]);

  const selectedItem = useMemo(() => items.find((item) => item.item_number === selectedItemNumber) || null, [items, selectedItemNumber]);

  async function submitRestock() {
    if (!selectedItemNumber) return;
    const qty = asNumber(restockQty);
    if (qty <= 0) {
      setError('Restock quantity must be greater than 0.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/inventory/${encodeURIComponent(selectedItemNumber)}/restock`, 'POST', {
        qty,
        notes: actionNotes || undefined,
      });
      setRestockQty('');
      setActionNotes('');
      setNotice(`Restocked ${selectedItemNumber} by ${qty.toLocaleString()}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Restock failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAdjustment() {
    if (!selectedItemNumber) return;
    const delta = asNumber(adjustDelta);
    if (delta === 0) {
      setError('Adjustment delta must be non-zero.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/inventory/${encodeURIComponent(selectedItemNumber)}/adjust`, 'POST', {
        delta,
        notes: actionNotes || undefined,
      });
      setAdjustDelta('');
      setActionNotes('');
      setNotice(`Adjusted ${selectedItemNumber} by ${delta > 0 ? '+' : ''}${delta.toLocaleString()}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Adjustment failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading inventory...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="SKUs" value={summary.totalSkus.toLocaleString()} />
        <SummaryCard label="Low Stock" value={summary.lowStock.toLocaleString()} />
        <SummaryCard label="Out Of Stock" value={summary.outOfStock.toLocaleString()} />
        <SummaryCard label="Inventory Value" value={money(summary.inventoryValue)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory Actions</CardTitle>
          <CardDescription>Perform restock and quantity adjustments using existing inventory APIs.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Item</span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedItemNumber}
              onChange={(event) => setSelectedItemNumber(event.target.value)}
            >
              <option value="">Select item...</option>
              {items.map((item) => (
                <option key={item.id} value={item.item_number || ''}>
                  {item.item_number} - {item.description}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Restock Qty</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={restockQty}
              onChange={(event) => setRestockQty(event.target.value)}
              placeholder="e.g. 25"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Adjustment Delta</span>
            <Input
              type="number"
              step="0.01"
              value={adjustDelta}
              onChange={(event) => setAdjustDelta(event.target.value)}
              placeholder="e.g. -2.5"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-4">
            <span className="font-semibold text-muted-foreground">Notes</span>
            <Input value={actionNotes} onChange={(event) => setActionNotes(event.target.value)} placeholder="Optional movement notes" />
          </label>
          <div className="md:col-span-4 flex flex-wrap gap-2">
            <Button onClick={submitRestock} disabled={submitting || !selectedItemNumber}>
              Restock Item
            </Button>
            <Button variant="secondary" onClick={submitAdjustment} disabled={submitting || !selectedItemNumber}>
              Apply Adjustment
            </Button>
            {selectedItem ? (
              <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Current: <strong>{asNumber(selectedItem.on_hand_qty).toLocaleString()}</strong> {selectedItem.unit || ''}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Inventory Overview</CardTitle>
            <CardDescription>Live stock visibility from existing `/api/inventory` routes.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item/category" />
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
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
              {filtered.length ? (
                filtered.map((item) => {
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
