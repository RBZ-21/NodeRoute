import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SelectInput } from '../ui/select-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { TableEmptyState } from '../ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { fetchListWithAuth, sendWithAuth } from '../../lib/api';
import type { InventoryItem } from '../../types/inventory.types';

function asNumber(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function money(value: unknown): string {
  return asNumber(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function reportDescription(item: InventoryItem): string {
  return item.description_line_1 || item.description || item.name || '';
}
function reportClassName(item: InventoryItem): string {
  return item.class_name || item.category || '';
}
function reportCostBase(item: InventoryItem): unknown {
  return item.cost_base ?? item.base_cost ?? item.cost;
}
function reportCostReal(item: InventoryItem): unknown {
  return item.cost_real ?? item.real_cost ?? item.cost;
}
function reportOnHandQuantity(item: InventoryItem): unknown {
  return item.on_hand_quantity ?? item.on_hand_qty ?? item.quantity;
}

export function InventoryTab({
  initialInventory,
  onNotice,
  onError,
}: {
  initialInventory: InventoryItem[];
  onNotice: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editQty, setEditQty] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setInventory(initialInventory); }, [initialInventory]);

  async function reload() {
    setLoading(true);
    try {
      const data = await fetchListWithAuth<InventoryItem>('/api/warehouse/inventory');
      setInventory(data);
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  async function saveQty(item: InventoryItem) {
    const qty = parseFloat(editQty);
    if (isNaN(qty)) { onError('Enter a valid quantity'); return; }
    setSaving(true);
    try {
      await sendWithAuth(`/api/warehouse/inventory/${item.id}`, 'PATCH', { quantity: qty });
      setInventory((prev) => prev.map((i) => i.id === item.id ? { ...i, quantity: qty, on_hand_qty: qty, on_hand_quantity: qty } : i));
      setEditingId(null);
      onNotice(`${reportDescription(item) || 'Item'} quantity updated.`);
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  const categories = Array.from(new Set(inventory.map((i) => reportClassName(i)).filter(Boolean))) as string[];

  const filtered = inventory.filter((item) => {
    const name = reportDescription(item).toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || (item.item_number || '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !categoryFilter || reportClassName(item) === categoryFilter;
    return matchSearch && matchCat;
  });

  function exportCsv() {
    const rows = [
      ['Item Number', 'Description Line 1', 'Class Name', 'Allocated Quantity', 'On Hand Weight', 'On Hand Quantity', 'Unit', 'Cost: Base', 'Cost: Real', 'Value at Cost', 'Value at Level 1', 'Status'],
      ...filtered.map((i) => [
        i.item_number || '',
        reportDescription(i),
        reportClassName(i),
        i.allocated_quantity ?? '',
        i.on_hand_weight ?? '',
        reportOnHandQuantity(i) ?? '',
        i.unit || '',
        reportCostBase(i) ?? '',
        reportCostReal(i) ?? '',
        i.value_at_cost ?? '',
        i.value_at_level_1 ?? '',
        i.status || '',
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'warehouse-inventory.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const getStatus = (item: InventoryItem) => item.status || 'active';
  const getQty = (item: InventoryItem): number | null => {
    const raw = reportOnHandQuantity(item);
    if (raw == null || raw === '') return null;
    const n = asNumber(raw);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <CardTitle>Inventory On-Hand</CardTitle>
          <CardDescription>Live inventory levels. Click Adjust to update a quantity.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            placeholder="Search item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search inventory items"
            className="rounded border border-input bg-background px-3 py-1.5 text-sm w-40"
          />
          <SelectInput
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by class name"
            className="h-auto rounded px-2 py-1.5"
          >
            <option value="">All Class Names</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectInput>
          <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
        </div>
      </CardHeader>
      <CardContent className="rounded-lg border border-border bg-card p-2">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item Number</TableHead>
              <TableHead>Description Line 1</TableHead>
              <TableHead>Class Name</TableHead>
              <TableHead>Allocated Quantity</TableHead>
              <TableHead>On Hand Weight</TableHead>
              <TableHead>On Hand Quantity</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Cost: Base</TableHead>
              <TableHead>Cost: Real</TableHead>
              <TableHead>Value at Cost</TableHead>
              <TableHead>Value at Level 1</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? filtered.map((item) => (
              <TableRow key={String(item.id)}>
                <TableCell className="font-medium">{item.item_number || '-'}</TableCell>
                <TableCell>{reportDescription(item) || '-'}</TableCell>
                <TableCell>{reportClassName(item) || '-'}</TableCell>
                <TableCell>{asNumber(item.allocated_quantity).toLocaleString()}</TableCell>
                <TableCell>{asNumber(item.on_hand_weight).toLocaleString()}</TableCell>
                <TableCell>
                  {editingId === item.id ? (
                    <input
                      type="number"
                      className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                      aria-label={`Adjust on-hand quantity for ${reportDescription(item) || item.item_number || 'item'}`}
                      autoFocus
                    />
                  ) : (
                    <span className={getQty(item) === 0 ? 'text-destructive font-semibold' : getQty(item) !== null && getQty(item)! < 5 ? 'text-amber-600 font-semibold' : ''}>
                      {getQty(item) != null ? getQty(item) : '-'}
                    </span>
                  )}
                </TableCell>
                <TableCell>{item.unit || '-'}</TableCell>
                <TableCell>{money(reportCostBase(item))}</TableCell>
                <TableCell>{money(reportCostReal(item))}</TableCell>
                <TableCell>{money(item.value_at_cost)}</TableCell>
                <TableCell>{money(item.value_at_level_1)}</TableCell>
                <TableCell>
                  <Badge variant={getStatus(item) === 'active' ? 'success' : getStatus(item) === 'low' ? 'warning' : 'secondary'}>
                    {getStatus(item)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {editingId === item.id ? (
                    <div className="flex gap-1">
                      <Button size="sm" disabled={saving} onClick={() => saveQty(item)}>{saving ? '...' : 'Save'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => { setEditingId(item.id); setEditQty(String(getQty(item) ?? '')); }}>Adjust</Button>
                  )}
                </TableCell>
              </TableRow>
            )) : (
              <TableEmptyState
                colSpan={13}
                title="No items match filters."
                description="Clear the filters or refresh warehouse inventory to load current on-hand rows."
                actionLabel="Refresh"
                onAction={() => void reload()}
              />
            )}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}
