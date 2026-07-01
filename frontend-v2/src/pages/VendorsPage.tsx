import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { SelectInput } from '../components/ui/select-input';
import { StatusBadge } from '../components/ui/status-badge';
import { SlideOver } from '../components/ui/overlay-panel';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { LoadingSkeleton, TableEmptyState } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useInventoryProducts } from '../hooks/usePurchasing';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import { type Vendor, useSaveVendorMutation, useVendorsQuery } from '../hooks/useVendors';
import { useToast } from '../components/ui/toast';

type VendorStatus = 'active' | 'inactive' | 'on-hold' | 'other';

const statusColors = {
  active: 'green',
  inactive: 'gray',
  'on-hold': 'yellow',
} as const;

type VendorApStatus = {
  vendor_id?: string | null;
  vendor_name?: string | null;
  total_open?: number | string;
  buckets?: Record<string, number>;
};

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

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatMoneyOrDash(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  return money(toNumber(value));
}

function asDaysLabel(value: unknown): string {
  const days = toNumber(value);
  return days > 0 ? `${days}d` : '-';
}

function formatNumberInput(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function formatSeasonalWindows(value: Vendor['seasonal_usage_windows']): string {
  if (Array.isArray(value)) return value.length ? JSON.stringify(value, null, 2) : '';
  return typeof value === 'string' ? value : '';
}

function normalizeCatalogItemNumber(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function vendorCatalogItemNumbers(vendor: Vendor): string[] {
  if (!Array.isArray(vendor.catalog_item_numbers)) return [];
  return Array.from(
    new Set(
      vendor.catalog_item_numbers
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

export function VendorsPage() {
  const navigate = useNavigate();
  const vendorsQuery = useVendorsQuery();
  const inventoryProductsQuery = useInventoryProducts();
  const saveVendorMutation = useSaveVendorMutation();

  const vendors = useMemo(() => vendorsQuery.data ?? [], [vendorsQuery.data]);
  const inventoryProducts = useMemo(
    () =>
      (inventoryProductsQuery.data ?? [])
        .filter((product) => String(product.item_number || '').trim())
        .sort((left, right) =>
          String(left.description || left.item_number || '').localeCompare(String(right.description || right.item_number || ''))
        ),
    [inventoryProductsQuery.data],
  );

  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | VendorStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');

  const [selected, setSelected] = useState<Vendor | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Vendor>({});
  const [saving, setSaving] = useState(false);

  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<Vendor>({});
  const [newSaving, setNewSaving] = useState(false);

  type VendorScore = { overall_grade: string; on_time_score: number; quality_score: number; price_consistency_score: number; summary: string; strengths: string[]; concerns: string[] };
  const [vendorScores, setVendorScores] = useState<Record<string, VendorScore>>({});
  const [scoreLoading, setScoreLoading] = useState<Record<string, boolean>>({});
  const [vendorApStatus, setVendorApStatus] = useState<Record<string, VendorApStatus>>({});
  const [apStatusLoading, setApStatusLoading] = useState<Record<string, boolean>>({});

  async function scoreVendor(id: string) {
    setScoreLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await sendWithAuth<VendorScore & { vendor_id: string }>('/api/ai/vendor-score', 'POST', { vendor_id: id });
      setVendorScores((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      toast.error(String((err as Error).message || 'Vendor scoring failed'));
    } finally {
      setScoreLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function loadVendorApStatus(vendor: Vendor) {
    const id = String(vendor.id || vendor.vendor_id || vendor.vendorId || '');
    if (!id) return;
    setApStatusLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await fetchWithAuth<VendorApStatus>(`/api/vendors/${encodeURIComponent(id)}/ap-status`);
      setVendorApStatus((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      toast.error(String((err as Error).message || 'Vendor AP status failed'));
    } finally {
      setApStatusLoading((prev) => ({ ...prev, [id]: false }));
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
    setSaving(true);    try {
      const updated = await saveVendorMutation.mutateAsync({ id: String(id), draft });
      setSelected({ ...selected!, ...updated });
      setEditing(false);
      toast.success(`${draft.name || vendorName(draft)} saved.`);
    } catch (err) {
      toast.error(String((err as Error).message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function createVendor() {
    setNewSaving(true);    try {
      await saveVendorMutation.mutateAsync({ id: undefined, draft: newDraft });
      setAddingNew(false);
      setNewDraft({ status: 'active', catalog_item_numbers: [], seasonal_usage_windows: [] });
      toast.success(`Vendor "${newDraft.name || 'New Vendor'}" created.`);
      await vendorsQuery.refetch();
    } catch (err) {
      toast.error(String((err as Error).message || 'Create failed'));
    } finally {
      setNewSaving(false);
    }
  }

  function viewPOs(vendor: Vendor) {
    navigate(`/purchasing?vendor=${encodeURIComponent(vendorName(vendor))}`);
  }

  function newPO(vendor: Vendor) {
    navigate(`/purchasing?vendor=${encodeURIComponent(vendorName(vendor))}`);
    toast.success(`Opened new PO flow for ${vendorName(vendor)}.`);
  }

  const fetchError = vendorsQuery.error
    ? String((vendorsQuery.error as Error)?.message || 'Could not load vendors')
    : '';

  return (
    <div className="space-y-5">
      {vendorsQuery.isPending ? <PageSkeleton /> : null}
      {fetchError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{fetchError}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Vendors</CardTitle>
            <CardDescription>Supplier roster and PO activity from `/api/vendors`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | VendorStatus)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on-hold">On Hold</option>
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</span>
              <SelectInput value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All Categories</option>
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </SelectInput>
            </label>
            <Button variant="outline" onClick={() => void vendorsQuery.refetch()}>Refresh</Button>
            <Button onClick={() => { setNewDraft({ status: 'active', catalog_item_numbers: [], seasonal_usage_windows: [] }); setAddingNew(true); }}>+ Add Vendor</Button>
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
                  <TableHead>Catalog</TableHead>
                  <TableHead>Active POs</TableHead>
                  <TableHead>Min Order</TableHead>
                  <TableHead>Lead Time</TableHead>
                  <TableHead>AP Open</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((vendor, index) => {
                const status = normalizeStatus(vendor.status);
                const apKey = String(vendor.id || vendor.vendor_id || vendor.vendorId || '');
                return (
                  <TableRow key={vendorId(vendor, index)}>
                    <TableCell className="font-medium">{vendorId(vendor, index)}</TableCell>
                    <TableCell>{vendorName(vendor)}</TableCell>
                    <TableCell>{vendorContact(vendor)}</TableCell>
                    <TableCell>{vendor.email || '-'}</TableCell>
                    <TableCell>{vendor.phone || '-'}</TableCell>
                    <TableCell>{vendor.category || '-'}</TableCell>
                    <TableCell>
                      {vendorCatalogItemNumbers(vendor).length
                        ? `${vendorCatalogItemNumbers(vendor).length} SKU${vendorCatalogItemNumbers(vendor).length === 1 ? '' : 's'}`
                        : 'All inventory'}
                    </TableCell>
                    <TableCell>{activePOs(vendor).toLocaleString()}</TableCell>
                    <TableCell>{formatMoneyOrDash(vendor.min_order_value)}</TableCell>
                    <TableCell>{asDaysLabel(vendor.lead_time_days)}</TableCell>
                    <TableCell>{formatMoneyOrDash(vendorApStatus[apKey]?.total_open)}</TableCell>
                    <TableCell><StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" onClick={() => viewPOs(vendor)}>View POs</Button>
                        <Button variant="secondary" size="sm" onClick={() => newPO(vendor)}>New PO</Button>
                        <Button size="sm" onClick={() => openVendor(vendor)}>Edit</Button>
                        {apKey ? (
                          <Button variant="ghost" size="sm" onClick={() => void loadVendorApStatus(vendor)} disabled={apStatusLoading[apKey]}>
                            {apStatusLoading[apKey] ? 'Loading' : 'AP'}
                          </Button>
                        ) : null}
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
                <TableEmptyState
                  colSpan={13}
                  title="No vendors found for the selected filters."
                  description="Add a vendor profile to track purchasing rules, catalog coverage, and AP status."
                  actionLabel="+ Add Vendor"
                  onAction={() => { setNewDraft({ status: 'active', catalog_item_numbers: [], seasonal_usage_windows: [] }); setAddingNew(true); }}
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {addingNew ? (
        <SlideOver
          open
          title="New Vendor"
          description="Fill in the details below to add a vendor."
          onClose={() => setAddingNew(false)}
          widthClassName="max-w-md"
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => setAddingNew(false)}>Cancel</Button>
              <Button size="sm" disabled={newSaving} onClick={createVendor}>{newSaving ? 'Saving...' : 'Save'}</Button>
            </>
          }
        >
          <div className="space-y-4">
              <VendorField label="Name" value={newDraft.name} editing onChange={(v) => setNewDraft((d) => ({ ...d, name: v }))} />
              <VendorField label="Contact" value={newDraft.contact} editing onChange={(v) => setNewDraft((d) => ({ ...d, contact: v }))} />
              <VendorField label="Email" value={newDraft.email} editing onChange={(v) => setNewDraft((d) => ({ ...d, email: v }))} />
              <VendorField label="Phone" value={newDraft.phone} editing onChange={(v) => setNewDraft((d) => ({ ...d, phone: v }))} />
              <VendorField label="Category" value={newDraft.category} editing onChange={(v) => setNewDraft((d) => ({ ...d, category: v }))} />
              <VendorCatalogField
                value={newDraft.catalog_item_numbers}
                editing
                products={inventoryProducts}
                loading={inventoryProductsQuery.isPending}
                onChange={(catalog_item_numbers) => setNewDraft((d) => ({ ...d, catalog_item_numbers }))}
              />
              <VendorField label="Address" value={newDraft.address} editing onChange={(v) => setNewDraft((d) => ({ ...d, address: v }))} />
              <VendorField label="Payment Terms" value={newDraft.payment_terms} editing onChange={(v) => setNewDraft((d) => ({ ...d, payment_terms: v }))} />
              <VendorPlanningFields
                draft={newDraft}
                editing
                onChange={(patch) => setNewDraft((d) => ({ ...d, ...patch }))}
              />
              <div className="flex items-start gap-3">
                <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                <SelectInput value={newDraft.status || 'active'} onChange={(e) => setNewDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="on-hold">On Hold</option>
                </SelectInput>
              </div>
              <VendorField label="Notes" value={newDraft.notes} editing onChange={(v) => setNewDraft((d) => ({ ...d, notes: v }))} multiline />
          </div>
        </SlideOver>
      ) : null}

      {selected ? (
        <SlideOver
          open
          title={vendorName(selected)}
          description={vendorId(selected, 0)}
          onClose={() => setSelected(null)}
          widthClassName="max-w-md"
          actions={
            !editing ? (
              <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); }}>Cancel</Button>
                <Button size="sm" disabled={saving} onClick={saveVendor}>{saving ? 'Saving...' : 'Save'}</Button>
              </>
            )
          }
        >
          <div className="space-y-4">
              <VendorField label="Name" value={draft.name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
              <VendorField label="Contact" value={draft.contact || draft.contactName || draft.contact_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, contact: v }))} />
              <VendorField label="Email" value={draft.email} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
              <VendorField label="Phone" value={draft.phone} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
              <VendorField label="Category" value={draft.category} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} />
              <VendorCatalogField
                value={draft.catalog_item_numbers}
                editing={editing}
                products={inventoryProducts}
                loading={inventoryProductsQuery.isPending}
                onChange={(catalog_item_numbers) => setDraft((d) => ({ ...d, catalog_item_numbers }))}
              />
              <VendorField label="Address" value={draft.address} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, address: v }))} />
              <VendorField label="Payment Terms" value={draft.payment_terms} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, payment_terms: v }))} />
              <VendorPlanningFields
                draft={draft}
                editing={editing}
                onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              />
              {vendorApStatus[String(selected.id || selected.vendor_id || selected.vendorId || '')] ? (
                <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                  <div className="font-medium text-foreground">AP Open {formatMoneyOrDash(vendorApStatus[String(selected.id || selected.vendor_id || selected.vendorId || '')]?.total_open)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Current {formatMoneyOrDash(vendorApStatus[String(selected.id || selected.vendor_id || selected.vendorId || '')]?.buckets?.current)} · 30 {formatMoneyOrDash(vendorApStatus[String(selected.id || selected.vendor_id || selected.vendorId || '')]?.buckets?.['30'])} · 60 {formatMoneyOrDash(vendorApStatus[String(selected.id || selected.vendor_id || selected.vendorId || '')]?.buckets?.['60'])} · 90+ {formatMoneyOrDash((vendorApStatus[String(selected.id || selected.vendor_id || selected.vendorId || '')]?.buckets?.['90'] || 0) + (vendorApStatus[String(selected.id || selected.vendor_id || selected.vendorId || '')]?.buckets?.['120_plus'] || 0))}
                  </div>
                </div>
              ) : null}
              <div className="flex items-start gap-3">
                <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                {editing ? (
                  <SelectInput value={draft.status || ''} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on-hold">On Hold</option>
                  </SelectInput>
                ) : (
                  <span className="text-sm capitalize">{selected.status || '-'}</span>
                )}
              </div>
              <VendorField label="Notes" value={draft.notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} multiline />
          </div>
        </SlideOver>
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

function VendorPlanningFields({
  draft,
  editing,
  onChange,
}: {
  draft: Vendor;
  editing: boolean;
  onChange: (patch: Partial<Vendor>) => void;
}) {
  return (
    <>
      <VendorField label="Min Order" value={formatNumberInput(draft.min_order_value)} editing={editing} onChange={(v) => onChange({ min_order_value: v })} />
      <VendorField label="Pallet Qty" value={formatNumberInput(draft.pallet_qty)} editing={editing} onChange={(v) => onChange({ pallet_qty: v })} />
      <VendorField label="Layer Qty" value={formatNumberInput(draft.layer_qty)} editing={editing} onChange={(v) => onChange({ layer_qty: v })} />
      <VendorField label="Lead Days" value={formatNumberInput(draft.lead_time_days)} editing={editing} onChange={(v) => onChange({ lead_time_days: v })} />
      <VendorField label="Seasonal Windows" value={formatSeasonalWindows(draft.seasonal_usage_windows)} editing={editing} onChange={(v) => onChange({ seasonal_usage_windows: v })} multiline />
    </>
  );
}

function VendorCatalogField({
  value,
  editing,
  products,
  loading,
  onChange,
}: {
  value?: string[] | null;
  editing: boolean;
  products: Array<{ item_number: string; description: string; unit?: string; category?: string }>;
  loading: boolean;
  onChange: (value: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const selectedItemNumbers = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(value) ? value : [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        )
      ),
    [value],
  );
  const selectedLookup = useMemo(
    () => new Set(selectedItemNumbers.map((entry) => normalizeCatalogItemNumber(entry))),
    [selectedItemNumbers],
  );
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products.slice(0, 24);
    return products.filter((product) => {
      const haystack = `${product.description} ${product.item_number} ${product.category || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [products, search]);
  const selectedPreview = selectedItemNumbers.slice(0, 4).join(', ');

  function toggleItem(itemNumber: string) {
    const normalized = normalizeCatalogItemNumber(itemNumber);
    const next = selectedItemNumbers.filter((entry) => normalizeCatalogItemNumber(entry) !== normalized);
    if (next.length === selectedItemNumbers.length) {
      next.push(itemNumber.trim());
    }
    onChange(next.sort((left, right) => left.localeCompare(right)));
  }

  return (
    <div className="flex items-start gap-3">
      <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Catalog</span>
      {editing ? (
        <div className="flex-1 space-y-2">
          <div className="rounded-lg border border-border bg-muted/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">
                {selectedItemNumbers.length
                  ? `Scoped to ${selectedItemNumbers.length} SKU${selectedItemNumbers.length === 1 ? '' : 's'}`
                  : 'No catalog filter yet'}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => onChange([])} disabled={!selectedItemNumbers.length}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search catalog items"
                aria-label="Search catalog items"
              />
              {loading ? (
                <LoadingSkeleton rows={3} label="Loading inventory items" className="bg-background" />
              ) : filteredProducts.length ? (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {filteredProducts.map((product) => {
                    const itemNumber = String(product.item_number || '').trim();
                    const checked = selectedLookup.has(normalizeCatalogItemNumber(itemNumber));
                    return (
                      <label key={itemNumber} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(itemNumber)}
                          aria-label={`${product.description} ${itemNumber}`}
                        />
                        <span>
                          <span className="block font-medium text-foreground">{product.description}</span>
                          <span className="block text-xs text-muted-foreground">
                            #{itemNumber} · {product.category || 'Uncategorized'} · {product.unit || 'unit'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-sm text-muted-foreground">
                  No inventory items matched that search.
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Leave the catalog empty to keep the PO form open to all inventory items. Assign SKUs here to narrow product suggestions to this vendor.
          </div>
        </div>
      ) : (
        <span className="text-sm">
          {selectedItemNumbers.length
            ? `${selectedItemNumbers.length} SKU${selectedItemNumbers.length === 1 ? '' : 's'}${selectedPreview ? ` · ${selectedPreview}` : ''}`
            : 'All inventory'}
        </span>
      )}
    </div>
  );
}
