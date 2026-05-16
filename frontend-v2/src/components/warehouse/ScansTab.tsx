import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { fetchWithAuth, sendWithAuth } from '../../lib/api';
import { ACTION_COLORS } from './WarehouseTypes';
import type { ScanEvent } from './WarehouseTypes';

export function ScansTab({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ item_number: '', action: 'scan', quantity: '', unit: '', location_id: '', lot_number: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.set('action', actionFilter);
      if (dateFilter) params.set('date', dateFilter);
      const data = await fetchWithAuth<ScanEvent[]>(`/api/warehouse/scans?${params}`);
      setScans(data);
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [actionFilter, dateFilter]);

  async function submitScan(e: React.FormEvent) {
    e.preventDefault();
    if (!form.item_number || !form.action) { onError('Item number and action are required'); return; }
    setSubmitting(true);
    try {
      const payload: Record<string, any> = { item_number: form.item_number, action: form.action, notes: form.notes || undefined };
      if (form.quantity) payload.quantity = parseFloat(form.quantity);
      if (form.unit) payload.unit = form.unit;
      if (form.location_id) payload.location_id = form.location_id;
      if (form.lot_number) payload.lot_number = form.lot_number;
      await sendWithAuth('/api/warehouse/scans', 'POST', payload);
      onNotice('Scan event logged.');
      setShowForm(false);
      setForm({ item_number: '', action: 'scan', quantity: '', unit: '', location_id: '', lot_number: '', notes: '' });
      load();
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  function exportCsv() {
    const rows = [
      ['Date', 'Item #', 'Action', 'Qty', 'Unit', 'Lot', 'Location', 'Notes'],
      ...scans.map((s) => [s.created_at, s.item_number, s.action, s.quantity ?? '', s.unit ?? '', s.lot_number ?? '', s.location_id ?? '', s.notes ?? '']),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'warehouse-scans.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {showForm && (
        <Card>
          <CardHeader><CardTitle>Log Scan Event</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submitScan} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Item Number *</label>
                <input required className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.item_number} onChange={(e) => setForm({ ...form, item_number: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Action *</label>
                <select required className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                  {['scan', 'receive', 'pick', 'adjust', 'transfer'].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Quantity</label>
                <input type="number" className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Unit</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Lot Number</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Location ID</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Log Event'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Scan Event Log</CardTitle>
            <CardDescription>Receive, pick, adjust, scan, and transfer events.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="rounded border border-input bg-background px-2 py-1.5 text-sm">
              <option value="">All Actions</option>
              {['scan', 'receive', 'pick', 'adjust', 'transfer'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="rounded border border-input bg-background px-2 py-1.5 text-sm" />
            <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>+ Log Event</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead>Item #</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.length ? scans.map((s) => (
                <TableRow key={String(s.id)}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-sm">{s.item_number}</TableCell>
                  <TableCell>
                    <Badge variant={(ACTION_COLORS[s.action] || 'secondary') as any}>{s.action}</Badge>
                  </TableCell>
                  <TableCell>{s.quantity != null ? `${s.quantity}${s.unit ? ' ' + s.unit : ''}` : '-'}</TableCell>
                  <TableCell className="text-xs">{s.lot_number || '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{s.notes || '-'}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No scan events found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
