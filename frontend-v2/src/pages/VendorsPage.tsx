import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { sendWithAuth } from '../lib/api';
import { type Vendor, useSaveVendorMutation, useVendorsQuery } from '../hooks/useVendors';

type VendorStatus = 'active' | 'inactive' | 'on-hold' | 'other';

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
  const vendorsQuery = useVendorsQuery();
  const saveVendorMutation = useSaveVendorMutation();

  const vendors = vendorsQuery.data ?? [];

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VendorStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');

  // Edit panel
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Vendor>({});
  const [saving, setSaving] = useState(false);

  // Add Vendor panel
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<Vendor>({});
  const [newSaving, setNewSaving] = useState(false);

  // AI: Vendor scoring — not server state, kept as direct sendWithAuth calls
  type VendorScore = { overall_grade: string; on_time_score: number; quality_score: number; price_consistency_score: number; summary: string; strengths: string[]; concerns: string[] };
  const [vendorScores, setVendorScores] = useState<Record<string, VendorScore>>({});
  const [scoreLoading, setScoreLoading] = useState<Record<string, boolean>>({});

  async function scoreVendor(id: string) {
    setScoreLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await sendWithAuth<VendorScore & { vendor_id: string }>('/api/ai/vendor-score', 'POST', { vendor_id: id });
      setVendorScores((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError(String((err as Error).message || 'Vendor scoring failed'));
    } finally {
      setScoreLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

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
      const updated = await saveVendorMutation.mutateAsync({ id, draft });
      setSelected({ ...selected!, ...updated });
      setEditing(false);
      setNotice(`${draft.name || vendorName(draft)} saved.`);
    } catch (err) {
      setError(String((err as Error).message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function createVendor() {
    setNewSaving(true);
    setError('');
    try {
      await saveVendorMutation.mutateAsync({ id: null, draft: newDraft });
      setAddingNew(false);
      setNewDraft({});
      setNotice(`Vendor "${newDraft.name || 'New Vendor'}" created.`);
      await vendorsQuery.refetch();
    } catch (err) {
      setError(String((err as Error).message || 'Create failed'));
    } finally {
      setNewSaving(false);
    }
  }

  function viewPOs(vendor: Vendor) {
    navigate(`/purchasing?vendor=${encodeURIComponent(vendorName(vendor))}`);
  }

  function newPO(vendor: Vendor) {
    navigate(`/purchasing?vendor=${encodeURIComponent(vendorName(vendor))}`);
    setNotice(`Opened new PO flow for ${vendorName(vendor)}.`);
  }

  const fetchError = vendorsQuery.error
    ? String((vendorsQuery.error as Error)?.message || 'Could not load vendors')
    : '';
  const displayError = error || fetchError;

  return (
    <div className="space-y-5">
      {vendorsQuery.isPending ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading vendors...</div> : null}
      {displayError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{displayError}</div> : null}
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
            <Button variant="outline" onClick={() => void vendorsQuery.refetch()}>Refresh</Button>
            <Button onClick={() => { setNewDraft({ status: 'active' }); setAddingNew(true); }}>+ Add Vendor</Button>
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
                        {vendor.id && (
                          <Button variant="ghost" size="sm" onClick={() => void scoreVendor(String(vendor.id))} disabled={scoreLoading[String(vendor.id)]} title="AI performance score">
                            {scoreLoading[String(vendor.id)] ? '…' : '✦ Score'}
                          </Button>
                        )}
                        {vendor.id && vendorScores[String(vendor.id)] && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${vendorScores[String(vendor.id)].overall_grade === 'A' ? 'bg-emerald-100 text-emerald-700' : vendorScores[String(vendor.id)].overall_grade === 'B' ? 'bg-blue-100 text-blue-700' : vendorScores[String(vendor.id)].overall_grade === 'C' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                            {vendorScores[String(vendor.id)].overall_grade}
                          </span>
                        )}
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

      {/* ── Add Vendor Slide-Over ── */}
      {addingNew ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAddingNew(false)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">New Vendor</h2>
                <p className="text-sm text-muted-foreground">Fill in the details below to add a vendor.</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setAddingNew(false)}>Cancel</Button>
                <Button size="sm" disabled={newSaving} onClick={createVendor}>{newSaving ? 'Saving...' : 'Save'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingNew(false)}>✕</Button>
              </div>
            </div>
            <div className="flex-1 space-y-4 p-6">
              <VendorField label="Name" value={newDraft.name} editing onChange={(v) => setNewDraft((d) => ({ ...d, name: v }))} />
              <VendorField label="Contact" value={newDraft.contact} editing onChange={(v) => setNewDraft((d) => ({ ...d, contact: v }))} />
              <VendorField label="Email" value={newDraft.email} editing onChange={(v) => setNewDraft((d) => ({ ...d, email: v }))} />
              <VendorField label="Phone" value={newDraft.phone} editing onChange={(v) => setNewDraft((d) => ({ ...d, phone: v }))} />
              <VendorField label="Category" value={newDraft.category} editing onChange={(v) => setNewDraft((d) => ({ ...d, category: v }))} />
              <VendorField label="Address" value={newDraft.address} editing onChange={(v) => setNewDraft((d) => ({ ...d, address: v }))} />
              <VendorField label="Payment Terms" value={newDraft.payment_terms} editing onChange={(v) => setNewDraft((d) => ({ ...d, payment_terms: v }))} />
              <div className="flex items-start gap-3">
                <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                <select value={newDraft.status || 'active'} onChange={(e) => setNewDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="on-hold">On Hold</option>
                </select>
              </div>
              <VendorField label="Notes" value={newDraft.notes} editing onChange={(v) => setNewDraft((d) => ({ ...d, notes: v }))} multiline />
            </div>
          </div>
        </div>
      ) : null}

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
