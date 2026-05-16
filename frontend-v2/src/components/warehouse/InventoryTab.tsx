import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { fetchWithAuth, sendWithAuth } from '../../lib/api';
import type { InventoryItem } from './WarehouseTypes';

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
      const data = await fetchWithAuth<InventoryItem[]>('/api/warehouse/inventory');
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
      setInventory((prev) => prev.map((i) => i.id === item.id ? { ...i, quantity: qty, on_hand_qty: qty } : i));
      setEditingId(null);
      onNotice(`${item.description || item.name || 'Item'} quantity updated.`);
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  const categories = Array.from(new Set(inventory.map((i) => i.category).filter(Boolean))) as string[];

  const filtered = inventory.filter((item) => {
    const name = (item.description || item.name || '').toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || (item.item_number || '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !categoryFilter || item.category === categoryFilter;
    return matchSearch && matchCat;
  });

  function exportCsv() {
    const rows = [
      ['Item', 'Category', 'Qty', 'Unit', 'Status', 'Cost'],
      ...filtered.map((i) => [
        i.description || i.name || '',
        i.category || '',
        i.on_hand_qty ?? i.quantity ?? '',
        i.unit || '',
        i.status || '',
        i.cost ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'warehouse-inventory.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const getStatus = (item: InventoryItem) => item.status || 'active';
  const getQty = (item: InventoryItem) => item.on_hand_qty ?? item.quantity ?? null;

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
            className="rounded border border-input bg-background px-3 py-1.5 text-sm w-40"
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
        </div>
      </CardHeader>
      <CardContent className="rounded-lg border border-border bg-card p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? filtered.map((item) => (
              <TableRow key={String(item.id)}>
                <TableCell className="font-medium">{item.description || item.name || '-'}</TableCell>
                <TableCell>{item.category || '-'}</TableCell>
                <TableCell>
                  {editingId === item.id ? (
                    <input
                      type="number"
                      className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    <span className={getQty(item) === 0 ? 'text-destructive font-semibold' : getQty(item) !== null && getQty(item)! < 5 ? 'text-amber-600 font-semibold' : ''}>
                      {getQty(item) != null ? getQty(item) : '-'}
                    </span>
                  )}
                </TableCell>
                <TableCell>{item.unit || '-'}</TableCell>
                <TableCell>
                  <Badge variant={(getStatus(item) === 'active' ? 'success' : getStatus(item) === 'low' ? 'warning' : 'secondary') as any}>
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
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No items match filters.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
