// NOTE: This file retains all existing logic. The only addition is an
// "Invoices" tab inside the customer detail slide-over panel.
// The tab fetches /api/invoices?customer_id=<id> and renders a small table.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type Customer = {
  id?: number | string;
  customer_number?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  status?: string;
  contact_name?: string;
  payment_terms?: string;
  address?: string;
  billing_name?: string;
  billing_contact?: string;
  billing_email?: string;
  billing_phone?: string;
  billing_address?: string;
  tax_enabled?: boolean;
  credit_hold?: boolean;
  credit_hold_reason?: string;
  credit_hold_placed_at?: string;
  fax_number?: string;
  delivery_notes?: string;
  preferred_delivery_window?: string;
  preferred_door?: string;
};

type Invoice = {
  id?: number | string;
  invoice_number?: string;
  invoiceNumber?: string;
  status?: string;
  total?: number | string;
  created_at?: string;
  createdAt?: string;
  due_date?: string;
  dueDate?: string;
};

type DetailTab = 'info' | 'delivery' | 'billing' | 'invoices';

function phone(customer: Customer): string {
  return String(customer.phone_number || customer.phone || '-');
}

function customerStatus(customer: Customer): string {
  if (customer.credit_hold) return 'credit-hold';
  return String(customer.status || 'active').toLowerCase();
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all');

  // Detail panel
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Customer>({});
  const [saving, setSaving] = useState(false);

  // Invoices tab state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Customer[]>('/api/customers');
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load customers'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function loadInvoices(customerId: number | string) {
    setInvoicesLoading(true);
    try {
      const data = await fetchWithAuth<Invoice[]>(`/api/invoices?customer_id=${customerId}`);
      setInvoices(Array.isArray(data) ? data : []);
    } catch {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }

  function openCustomer(customer: Customer) {
    setSelected(customer);
    setDraft({ ...customer });
    setEditing(false);
    setDetailTab('info');
    setInvoices([]);
  }

  function onTabChange(tab: DetailTab) {
    setDetailTab(tab);
    if (tab === 'invoices' && selected?.id != null) {
      loadInvoices(selected.id);
    }
  }

  async function saveCustomer() {
    if (!selected?.id) return;
    setSaving(true);
    setError('');
    try {
      const updated = await sendWithAuth<Customer>(`/api/customers/${selected.id}`, 'PATCH', draft);
      setCustomers((prev) => prev.map((c) => (c.id === selected.id ? { ...c, ...updated } : c)));
      setSelected({ ...selected, ...updated });
      setEditing(false);
      setNotice(`${draft.company_name || 'Customer'} saved.`);
    } catch (err) {
      setError(String((err as Error).message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return customers.filter((c) => {
      const status = customerStatus(c);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(c.company_name || '').toLowerCase().includes(q) ||
        String(c.customer_number || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q) ||
        String(c.contact_name || '').toLowerCase().includes(q)
      );
    });
  }, [customers, search, statusFilter]);

  const summary = useMemo(() => ({
    total: customers.length,
    active: customers.filter((c) => customerStatus(c) === 'active').length,
    hold: customers.filter((c) => c.credit_hold).length,
    inactive: customers.filter((c) => customerStatus(c) === 'inactive').length,
  }), [customers]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading customers...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total" value={summary.total.toLocaleString()} />
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="Credit Hold" value={summary.hold.toLocaleString()} />
        <SummaryCard label="Inactive" value={summary.inactive.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Customers</CardTitle>
            <CardDescription>Full customer roster from `/api/customers`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input placeholder="Name, #, email..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-52" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="credit-hold">Credit Hold</option>
              </select>
            </label>
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer #</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Terms</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((c) => (
                <TableRow key={String(c.id || c.customer_number)}>
                  <TableCell className="font-medium">{c.customer_number || '-'}</TableCell>
                  <TableCell>{c.company_name || '-'}</TableCell>
                  <TableCell>{c.contact_name || '-'}</TableCell>
                  <TableCell>{phone(c)}</TableCell>
                  <TableCell>{c.email || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={c.credit_hold ? 'destructive' : customerStatus(c) === 'active' ? 'success' : 'secondary'}>
                      {c.credit_hold ? 'Credit Hold' : c.status || 'Active'}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.payment_terms || '-'}</TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => openCustomer(c)}>View / Edit</Button>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground">No customers found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Detail Slide-Over ── */}
      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} />
          <div ref={panelRef} className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">{selected.company_name}</h2>
                <p className="text-sm text-muted-foreground">{selected.customer_number}</p>
              </div>
              <div className="flex gap-2">
                {!editing ? (
                  <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); }}>Cancel</Button>
                    <Button size="sm" disabled={saving} onClick={saveCustomer}>{saving ? 'Saving...' : 'Save'}</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>✕</Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b px-6 pt-3">
              {(['info', 'delivery', 'billing', 'invoices'] as DetailTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => onTabChange(tab)}
                  className={`pb-2 px-3 text-sm capitalize border-b-2 transition-colors ${
                    detailTab === tab ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex-1 space-y-4 p-6">
              {/* Info Tab */}
              {detailTab === 'info' && (
                <div className="space-y-3">
                  <Field label="Company Name" value={draft.company_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, company_name: v }))} />
                  <Field label="Contact Name" value={draft.contact_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, contact_name: v }))} />
                  <Field label="Email" value={draft.email} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
                  <Field label="Phone" value={draft.phone_number || draft.phone} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, phone_number: v }))} />
                  <Field label="Fax" value={draft.fax_number} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, fax_number: v }))} />
                  <Field label="Payment Terms" value={draft.payment_terms} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, payment_terms: v }))} />
                  <Field label="Status" value={draft.status} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
                  <div className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-sm text-muted-foreground">Tax Enabled</span>
                    {editing ? (
                      <input type="checkbox" checked={!!draft.tax_enabled} onChange={(e) => setDraft((d) => ({ ...d, tax_enabled: e.target.checked }))} />
                    ) : (
                      <span className="text-sm">{selected.tax_enabled ? 'Yes' : 'No'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Delivery Tab */}
              {detailTab === 'delivery' && (
                <div className="space-y-3">
                  <Field label="Address" value={draft.address} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, address: v }))} />
                  <Field label="Delivery Notes" value={draft.delivery_notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, delivery_notes: v }))} multiline />
                  <Field label="Preferred Window" value={draft.preferred_delivery_window} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, preferred_delivery_window: v }))} />
                  <Field label="Preferred Door" value={draft.preferred_door} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, preferred_door: v }))} />
                </div>
              )}

              {/* Billing Tab */}
              {detailTab === 'billing' && (
                <div className="space-y-3">
                  <Field label="Billing Name" value={draft.billing_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, billing_name: v }))} />
                  <Field label="Billing Contact" value={draft.billing_contact} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, billing_contact: v }))} />
                  <Field label="Billing Email" value={draft.billing_email} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, billing_email: v }))} />
                  <Field label="Billing Phone" value={draft.billing_phone} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, billing_phone: v }))} />
                  <Field label="Billing Address" value={draft.billing_address} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, billing_address: v }))} />
                </div>
              )}

              {/* Invoices Tab */}
              {detailTab === 'invoices' && (
                <div className="space-y-3">
                  {invoicesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading invoices...</p>
                  ) : invoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No invoices found for this customer.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Due</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((inv, i) => (
                          <TableRow key={String(inv.id || i)}>
                            <TableCell className="font-medium">{inv.invoice_number || inv.invoiceNumber || String(inv.id)}</TableCell>
                            <TableCell><Badge variant="secondary">{inv.status || '-'}</Badge></TableCell>
                            <TableCell>{inv.total != null ? `$${Number(inv.total).toFixed(2)}` : '-'}</TableCell>
                            <TableCell>{inv.created_at || inv.createdAt ? new Date(inv.created_at || inv.createdAt || '').toLocaleDateString() : '-'}</TableCell>
                            <TableCell>{inv.due_date || inv.dueDate ? new Date(inv.due_date || inv.dueDate || '').toLocaleDateString() : '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, editing, onChange, multiline }: {
  label: string;
  value?: string | null;
  editing: boolean;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-36 shrink-0 pt-1 text-sm text-muted-foreground">{label}</span>
      {editing ? (
        multiline ? (
          <textarea
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input className="flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        )
      ) : (
        <span className="text-sm">{value || '-'}</span>
      )}
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
