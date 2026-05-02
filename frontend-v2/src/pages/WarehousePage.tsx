import { useEffect, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type InventoryItem = {
  id: string | number;
  name?: string;
  quantity?: number | null;
  unit?: string;
  category?: string;
  status?: string;
  location?: string;
  notes?: string;
};

type WarehouseSummary = {
  inventory: InventoryItem[];
  pendingInbound: number;
  todayStops: number;
  todayStopsCompleted: number;
};

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <p className="text-2xl font-bold">{value}</p>
      </CardHeader>
    </Card>
  );
}

export function WarehousePage() {
  const [summary, setSummary] = useState<WarehouseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editQty, setEditQty] = useState<string>('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<WarehouseSummary>('/api/warehouse');
      setSummary(data);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load warehouse data'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function saveQty(item: InventoryItem) {
    const qty = parseFloat(editQty);
    if (isNaN(qty)) { setError('Enter a valid quantity'); return; }
    setSaving(true);
    setError('');
    try {
      await sendWithAuth(`/api/warehouse/inventory/${item.id}`, 'PATCH', { quantity: qty });
      setSummary((prev) =>
        prev ? { ...prev, inventory: prev.inventory.map((i) => i.id === item.id ? { ...i, quantity: qty } : i) } : prev
      );
      setEditingId(null);
      setNotice(`${item.name || 'Item'} quantity updated.`);
      setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(String((err as Error).message || 'Failed to update quantity'));
    } finally {
      setSaving(false);
    }
  }

  const inventory = summary?.inventory || [];

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading warehouse data...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total SKUs" value={inventory.length} />
        <SummaryCard label="Pending Inbound POs" value={summary?.pendingInbound ?? '—'} />
        <SummaryCard label="Today's Stops" value={summary?.todayStops ?? '—'} />
        <SummaryCard label="Stops Completed" value={summary?.todayStopsCompleted ?? '—'} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Inventory On-Hand</CardTitle>
            <CardDescription>Live inventory levels. Click Adjust to update a quantity.</CardDescription>
          </div>
          <Button variant="outline" onClick={load}>Refresh</Button>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.length ? inventory.map((item) => (
                <TableRow key={String(item.id)}>
                  <TableCell className="font-medium">{item.name || '-'}</TableCell>
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
                      item.quantity != null ? item.quantity : '-'
                    )}
                  </TableCell>
                  <TableCell>{item.unit || '-'}</TableCell>
                  <TableCell>{item.location || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'active' ? 'success' : item.status === 'low' ? 'warning' : 'secondary'}>
                      {item.status || 'active'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {editingId === item.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" disabled={saving} onClick={() => saveQty(item)}>{saving ? '...' : 'Save'}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setEditingId(item.id); setEditQty(String(item.quantity ?? '')); }}>
                        Adjust
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No inventory items found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
