import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { fetchWithAuth, sendWithAuth } from '../../lib/api';
import { RETURN_STATUS_COLORS } from './WarehouseTypes';
import type { ReturnRecord } from './WarehouseTypes';

export function ReturnsTab({
  onNotice,
  onError,
  onSummaryRefresh,
}: {
  onNotice: (m: string) => void;
  onError: (m: string) => void;
  onSummaryRefresh: () => void;
}) {
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customer_name: '', item_number: '', item_description: '', quantity: '', unit: '', reason: '', lot_number: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | number | null>(null);
  const [resolveForm, setResolveForm] = useState({ status: 'resolved', resolution: '', restocked: false });
  const [resolveSaving, setResolveSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const data = await fetchWithAuth<ReturnRecord[]>(`/api/warehouse/returns?${params}`);
      setReturns(data);
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function submitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!form.item_number || !form.quantity || !form.reason) { onError('Item number, quantity, and reason are required'); return; }
    setSubmitting(true);
    try {
      await sendWithAuth('/api/warehouse/returns', 'POST', {
        customer_name: form.customer_name || undefined,
        item_number: form.item_number,
        item_description: form.item_description || undefined,
        quantity: parseFloat(form.quantity),
        unit: form.unit || undefined,
        reason: form.reason,
        lot_number: form.lot_number || undefined,
        notes: form.notes || undefined,
      });
      onNotice('Return logged.');
      setShowForm(false);
      setForm({ customer_name: '', item_number: '', item_description: '', quantity: '', unit: '', reason: '', lot_number: '', notes: '' });
      load();
      onSummaryRefresh();
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveResolve(id: string | number) {
    setResolveSaving(true);
    try {
      await sendWithAuth(`/api/warehouse/returns/${id}`, 'PATCH', {
        status: resolveForm.status,
        resolution: resolveForm.resolution || undefined,
        restocked: resolveForm.restocked,
      });
      onNotice('Return updated.');
      setResolvingId(null);
      load();
      onSummaryRefresh();
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setResolveSaving(false);
    }
  }

  function exportCsv() {
    const rows = [
      ['Date', 'Customer', 'Item #', 'Description', 'Qty', 'Unit', 'Reason', 'Lot', 'Status', 'Resolution'],
      ...returns.map((r) => [r.created_at, r.customer_name ?? '', r.item_number, r.item_description ?? '', r.quantity, r.unit ?? '', r.reason, r.lot_number ?? '', r.status, r.resolution ?? '']),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'warehouse-returns.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {showForm && (
        <Card>
          <CardHeader><CardTitle>Log Customer Return</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submitReturn} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Customer Name</label><input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Item Number *</label><input required className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.item_number} onChange={(e) => setForm({ ...form, item_number: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Item Description</label><input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.item_description} onChange={(e) => setForm({ ...form, item_description: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Quantity *</label><input required type="number" className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Unit</label><input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="lb, each, case..." value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Lot Number</label><input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-3"><label className="text-xs font-medium text-muted-foreground">Reason *</label><input required className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="e.g. Damaged packaging, wrong item, spoilage..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-3"><label className="text-xs font-medium text-muted-foreground">Notes</label><input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Log Return'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {resolvingId && (
        <Card>
          <CardHeader><CardTitle>Resolve Return</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">New Status</label><select className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" value={resolveForm.status} onChange={(e) => setResolveForm({ ...resolveForm, status: e.target.value })}><option value="resolved">resolved</option><option value="restocked">restocked</option><option value="discarded">discarded</option></select></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Resolution Notes</label><input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={resolveForm.resolution} onChange={(e) => setResolveForm({ ...resolveForm, resolution: e.target.value })} /></div>
              <div className="flex items-end gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={resolveForm.restocked} onChange={(e) => setResolveForm({ ...resolveForm, restocked: e.target.checked })} />Restocked</label></div>
              <div className="flex gap-2 sm:col-span-3">
                <Button disabled={resolveSaving} onClick={() => saveResolve(resolvingId)}>{resolveSaving ? 'Saving...' : 'Save'}</Button>
                <Button variant="ghost" onClick={() => setResolvingId(null)}>Cancel</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1"><CardTitle>Returns Tracking</CardTitle><CardDescription>Log and resolve customer product returns.</CardDescription></div>
          <div className="flex flex-wrap gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-input bg-background px-2 py-1.5 text-sm">
              <option value="">All Statuses</option>
              {['open', 'resolved', 'restocked', 'discarded'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>+ Log Return</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.length ? returns.map((r) => (
                <TableRow key={String(r.id)}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{r.customer_name || '-'}</TableCell>
                  <TableCell><div className="font-medium text-sm">{r.item_description || r.item_number}</div><div className="text-xs text-muted-foreground">{r.item_number}</div></TableCell>
                  <TableCell>{r.quantity}{r.unit ? ` ${r.unit}` : ''}</TableCell>
                  <TableCell className="text-sm max-w-[180px] truncate">{r.reason}</TableCell>
                  <TableCell><Badge variant={(RETURN_STATUS_COLORS[r.status] || 'secondary') as any}>{r.status}</Badge></TableCell>
                  <TableCell>
                    {r.status === 'open' ? (
                      <Button size="sm" variant="outline" onClick={() => { setResolvingId(r.id); setResolveForm({ status: 'resolved', resolution: r.resolution || '', restocked: r.restocked || false }); }}>Resolve</Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.resolution || '—'}</span>
                    )}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No returns found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
