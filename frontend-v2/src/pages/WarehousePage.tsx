import { useEffect, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type InventoryItem = {
  id: string | number;
  item_number?: string;
  description?: string;
  name?: string;
  on_hand_qty?: number | null;
  quantity?: number | null;
  unit?: string;
  category?: string;
  status?: string;
  location?: string;
  cost?: number | null;
};

type Location = {
  id: string | number;
  name: string;
  type: string;
  capacity?: number | null;
  notes?: string | null;
  status?: string;
};

type ScanEvent = {
  id: string | number;
  item_number: string;
  action: string;
  quantity?: number | null;
  unit?: string | null;
  location_id?: string | null;
  lot_number?: string | null;
  notes?: string | null;
  performed_by?: string | null;
  created_at: string;
};

type ReturnRecord = {
  id: string | number;
  customer_name?: string | null;
  item_number: string;
  item_description?: string | null;
  quantity: number;
  unit?: string | null;
  reason: string;
  lot_number?: string | null;
  notes?: string | null;
  status: string;
  resolution?: string | null;
  restocked?: boolean | null;
  created_at: string;
};

type WarehouseSummary = {
  inventory: InventoryItem[];
  pendingInbound: number;
  todayStops: number;
  todayStopsCompleted: number;
  todayScans: number;
  openReturns: number;
};

type Tab = 'inventory' | 'scans' | 'locations' | 'returns';

const ACTION_COLORS: Record<string, string> = {
  receive: 'success',
  pick: 'warning',
  adjust: 'secondary',
  scan: 'secondary',
  transfer: 'default',
};

const RETURN_STATUS_COLORS: Record<string, string> = {
  open: 'warning',
  resolved: 'success',
  restocked: 'success',
  discarded: 'destructive',
};

const LOCATION_TYPE_LABELS: Record<string, string> = {
  cooler: '❄️ Cooler',
  freezer: '🧊 Freezer',
  depot: '📦 Depot',
  dry: '🌾 Dry Storage',
  other: '🏭 Other',
};

// ── Helper Components ─────────────────────────────────────────────────────────

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

function ErrorBanner({ msg }: { msg: string }) {
  return <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{msg}</div>;
}

function NoticeBanner({ msg }: { msg: string }) {
  return <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function WarehousePage() {
  const [activeTab, setActiveTab] = useState<Tab>('inventory');
  const [summary, setSummary] = useState<WarehouseSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  }

  async function loadSummary() {
    setSummaryLoading(true);
    try {
      const data = await fetchWithAuth<WarehouseSummary>('/api/warehouse');
      setSummary(data);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load warehouse summary'));
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => { loadSummary(); }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'inventory', label: 'Inventory' },
    { key: 'scans', label: 'Scan Events' },
    { key: 'locations', label: 'Locations' },
    { key: 'returns', label: 'Returns' },
  ];

  return (
    <div className="space-y-5">
      {error ? <ErrorBanner msg={error} /> : null}
      {notice ? <NoticeBanner msg={notice} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Total SKUs" value={summaryLoading ? '—' : (summary?.inventory?.length ?? 0)} />
        <SummaryCard label="Pending Inbound" value={summaryLoading ? '—' : (summary?.pendingInbound ?? '—')} />
        <SummaryCard label="Today's Stops" value={summaryLoading ? '—' : (summary?.todayStops ?? '—')} />
        <SummaryCard label="Stops Completed" value={summaryLoading ? '—' : (summary?.todayStopsCompleted ?? '—')} />
        <SummaryCard label="Today's Scans" value={summaryLoading ? '—' : (summary?.todayScans ?? '—')} />
        <SummaryCard label="Open Returns" value={summaryLoading ? '—' : (summary?.openReturns ?? '—')} />
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'inventory' && (
        <InventoryTab
          initialInventory={summary?.inventory || []}
          onNotice={flash}
          onError={setError}
        />
      )}
      {activeTab === 'scans' && (
        <ScansTab onNotice={flash} onError={setError} />
      )}
      {activeTab === 'locations' && (
        <LocationsTab onNotice={flash} onError={setError} />
      )}
      {activeTab === 'returns' && (
        <ReturnsTab onNotice={flash} onError={setError} onSummaryRefresh={loadSummary} />
      )}
    </div>
  );
}

// ── Inventory Tab ─────────────────────────────────────────────────────────────

function InventoryTab({
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

// ── Scan Events Tab ───────────────────────────────────────────────────────────

function ScansTab({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
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

// ── Locations Tab ─────────────────────────────────────────────────────────────

function LocationsTab({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'cooler', capacity: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', type: '', capacity: '', notes: '', status: 'active' });
  const [editSaving, setEditSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchWithAuth<Location[]>('/api/warehouse/locations');
      setLocations(data);
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.type) { onError('Name and type are required'); return; }
    setSubmitting(true);
    try {
      const payload: Record<string, any> = { name: form.name, type: form.type, notes: form.notes || undefined };
      if (form.capacity) payload.capacity = parseFloat(form.capacity);
      await sendWithAuth('/api/warehouse/locations', 'POST', payload);
      onNotice(`Location "${form.name}" added.`);
      setShowForm(false);
      setForm({ name: '', type: 'cooler', capacity: '', notes: '' });
      load();
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(id: string | number) {
    setEditSaving(true);
    try {
      const payload: Record<string, any> = { name: editForm.name, type: editForm.type, status: editForm.status, notes: editForm.notes || undefined };
      if (editForm.capacity) payload.capacity = parseFloat(editForm.capacity);
      await sendWithAuth(`/api/warehouse/locations/${id}`, 'PATCH', payload);
      onNotice('Location updated.');
      setEditingId(null);
      load();
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {showForm && (
        <Card>
          <CardHeader><CardTitle>Add Location</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={addLocation} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <input required className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="e.g. Cooler A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type *</label>
                <select required className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(LOCATION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Capacity</label>
                <input type="number" className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="e.g. 5000 (lbs)" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Add Location'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Warehouse Locations</CardTitle>
            <CardDescription>Coolers, freezers, depots, and dry storage areas.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>+ Add Location</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.length ? locations.map((loc) => (
                <TableRow key={String(loc.id)}>
                  {editingId === loc.id ? (
                    <>
                      <TableCell><input className="w-28 rounded border border-input bg-background px-2 py-1 text-sm" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></TableCell>
                      <TableCell>
                        <select className="rounded border border-input bg-background px-1 py-1 text-sm" value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                          {Object.entries(LOCATION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </TableCell>
                      <TableCell><input type="number" className="w-20 rounded border border-input bg-background px-2 py-1 text-sm" value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} /></TableCell>
                      <TableCell>
                        <select className="rounded border border-input bg-background px-1 py-1 text-sm" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      </TableCell>
                      <TableCell><input className="w-32 rounded border border-input bg-background px-2 py-1 text-sm" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" disabled={editSaving} onClick={() => saveEdit(loc.id)}>{editSaving ? '...' : 'Save'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{loc.name}</TableCell>
                      <TableCell>{LOCATION_TYPE_LABELS[loc.type] || loc.type}</TableCell>
                      <TableCell>{loc.capacity != null ? `${loc.capacity} lbs` : '-'}</TableCell>
                      <TableCell>
                        <Badge variant={(loc.status === 'active' ? 'success' : 'secondary') as any}>{loc.status || 'active'}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{loc.notes || '-'}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => {
                          setEditingId(loc.id);
                          setEditForm({ name: loc.name, type: loc.type, capacity: String(loc.capacity ?? ''), notes: loc.notes || '', status: loc.status || 'active' });
                        }}>Edit</Button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No locations configured yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Returns Tab ───────────────────────────────────────────────────────────────

function ReturnsTab({
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
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Customer Name</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Item Number *</label>
                <input required className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.item_number} onChange={(e) => setForm({ ...form, item_number: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Item Description</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.item_description} onChange={(e) => setForm({ ...form, item_description: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Quantity *</label>
                <input required type="number" className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Unit</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="lb, each, case..." value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Lot Number</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                <label className="text-xs font-medium text-muted-foreground">Reason *</label>
                <input required className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="e.g. Damaged packaging, wrong item, spoilage..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
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
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">New Status</label>
                <select className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" value={resolveForm.status} onChange={(e) => setResolveForm({ ...resolveForm, status: e.target.value })}>
                  <option value="resolved">resolved</option>
                  <option value="restocked">restocked</option>
                  <option value="discarded">discarded</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Resolution Notes</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={resolveForm.resolution} onChange={(e) => setResolveForm({ ...resolveForm, resolution: e.target.value })} />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={resolveForm.restocked} onChange={(e) => setResolveForm({ ...resolveForm, restocked: e.target.checked })} />
                  Restocked
                </label>
              </div>
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
          <div className="space-y-1">
            <CardTitle>Returns Tracking</CardTitle>
            <CardDescription>Log and resolve customer product returns.</CardDescription>
          </div>
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
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.length ? returns.map((r) => (
                <TableRow key={String(r.id)}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{r.customer_name || '-'}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{r.item_description || r.item_number}</div>
                    <div className="text-xs text-muted-foreground">{r.item_number}</div>
                  </TableCell>
                  <TableCell>{r.quantity}{r.unit ? ` ${r.unit}` : ''}</TableCell>
                  <TableCell className="text-sm max-w-[180px] truncate">{r.reason}</TableCell>
                  <TableCell>
                    <Badge variant={(RETURN_STATUS_COLORS[r.status] || 'secondary') as any}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.status === 'open' ? (
                      <Button size="sm" variant="outline" onClick={() => {
                        setResolvingId(r.id);
                        setResolveForm({ status: 'resolved', resolution: r.resolution || '', restocked: r.restocked || false });
                      }}>Resolve</Button>
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
