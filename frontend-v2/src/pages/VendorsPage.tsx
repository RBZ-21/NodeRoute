import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type VendorStatus = 'active' | 'inactive' | 'on-hold' | 'other';

type Vendor = {
  id?: string | number;
  vendorId?: string;
  vendor_id?: string;
  name?: string;
  contact?: string;
  contactName?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  category?: string;
  activePOs?: number | string;
  active_pos?: number | string;
  status?: string;
  address?: string;
  notes?: string;
  payment_terms?: string;
};

const statusColors = {
  active: 'green',
  inactive: 'gray',
  'on-hold': 'yellow',
} as const;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value: string | undefined): VendorStatus {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (normalized === 'active') return 'active';
  if (normalized === 'inactive') return 'inactive';
  if (normalized === 'on-hold') return 'on-hold';
  return 'other';
}

function vendorId(vendor: Vendor, index: number): string {
  return String(vendor.vendorId || vendor.vendor_id || vendor.id || `VND-${index + 1}`);
}

function vendorName(vendor: Vendor): string {
  return String(vendor.name || '-');
}

function vendorContact(vendor: Vendor): string {
  return String(vendor.contact || vendor.contactName || vendor.contact_name || '-');
}

function activePOs(vendor: Vendor): number {
  return toNumber(vendor.activePOs ?? vendor.active_pos);
}

export function VendorsPage() {
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VendorStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');

  // Edit panel
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Vendor>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Vendor[]>('/api/vendors');
      setVendors(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load vendors'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const categoryOptions = useMemo(() => {
    const options = new Set<string>();
    for (const vendor of vendors) {
      const category = String(vendor.category || '').trim();
      if (category) options.add(category);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [vendors]);

  const filtered = useMemo(() => {
    return vendors.filter((vendor) => {
      const status = normalizeStatus(vendor.status);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (categoryFilter !== 'all' && String(vendor.category || '') !== categoryFilter) return false;
      return true;
    });
  }, [vendors, statusFilter, categoryFilter]);

  function openVendor(vendor: Vendor) {
    setSelected(vendor);
    setDraft({ ...vendor });
    setEditing(false);
  }

  async function saveVendor() {
    const id = selected?.id || selected?.vendor_id || selected?.vendorId;
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const updated = await sendWithAuth<Vendor>(`/api/vendors/${id}`, 'PATCH', draft);
      setVendors((prev) => prev.map((v) => String(v.id) === String(id) ? { ...v, ...updated } : v));
      setSelected({ ...selected!, ...updated });
      setEditing(false);
      setNotice(`${draft.name || vendorName(draft)} saved.`);
    } catch (err) {
      setError(String((err as Error).message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  function viewPOs(vendor: Vendor) {
    navigate(`/purchasing?vendor=${encodeURIComponent(vendorName(vendor))}`);
  }

  function newPO(vendor: Vendor) {
    navigate(`/purchasing?vendor=${encodeURIComponent(vendorName(vendor))}`);
    setNotice(`Opened new PO flow for ${vendorName(vendor)}.`);
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading vendors...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Vendors</CardTitle>
            <CardDescription>Supplier roster and PO activity from `/api/vendors`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | VendorStatus)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on-hold">On Hold</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</span>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All Categories</option>
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Active POs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((vendor, index) => {
                const status = normalizeStatus(vendor.status);
                return (
                  <TableRow key={vendorId(vendor, index)}>
                    <TableCell className="font-medium">{vendorId(vendor, index)}</TableCell>
                    <TableCell>{vendorName(vendor)}</TableCell>
                    <TableCell>{vendorContact(vendor)}</TableCell>
                    <TableCell>{vendor.email || '-'}</TableCell>
                    <TableCell>{vendor.phone || '-'}</TableCell>
                    <TableCell>{vendor.category || '-'}</TableCell>
                    <TableCell>{activePOs(vendor).toLocaleString()}</TableCell>
                    <TableCell><StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" onClick={() => viewPOs(vendor)}>View POs</Button>
                        <Button variant="secondary" size="sm" onClick={() => newPO(vendor)}>New PO</Button>
                        <Button size="sm" onClick={() => openVendor(vendor)}>Edit</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow><TableCell colSpan={9} className="text-muted-foreground">No vendors found for the selected filters.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Vendor Edit Slide-Over ── */}
      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">{vendorName(selected)}</h2>
                <p className="text-sm text-muted-foreground">{vendorId(selected, 0)}</p>
              </div>
              <div className="flex gap-2">
                {!editing ? (
                  <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); }}>Cancel</Button>
                    <Button size="sm" disabled={saving} onClick={saveVendor}>{saving ? 'Saving...' : 'Save'}</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>✕</Button>
              </div>
            </div>
            <div className="flex-1 space-y-4 p-6">
              <VendorField label="Name" value={draft.name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
              <VendorField label="Contact" value={draft.contact || draft.contactName || draft.contact_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, contact: v }))} />
              <VendorField label="Email" value={draft.email} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
              <VendorField label="Phone" value={draft.phone} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
              <VendorField label="Category" value={draft.category} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} />
              <VendorField label="Address" value={draft.address} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, address: v }))} />
              <VendorField label="Payment Terms" value={draft.payment_terms} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, payment_terms: v }))} />
              <div className="flex items-start gap-3">
                <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                {editing ? (
                  <select value={draft.status || ''} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on-hold">On Hold</option>
                  </select>
                ) : (
                  <span className="text-sm capitalize">{selected.status || '-'}</span>
                )}
              </div>
              <VendorField label="Notes" value={draft.notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} multiline />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VendorField({ label, value, editing, onChange, multiline }: { label: string; value?: string | null; editing: boolean; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">{label}</span>
      {editing ? (
        multiline ? (
          <textarea className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input className="flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        )
      ) : (
        <span className="text-sm">{value || '-'}</span>
      )}
    </div>
  );
}
