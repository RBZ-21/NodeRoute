import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, ChevronRight, Phone, Mail, MapPin, CreditCard,
  ClipboardList, Star, Edit2, Check, RefreshCw,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import { cn } from '../lib/utils';

type CustomerStatus = 'active' | 'inactive' | 'on-hold' | 'other';

type Customer = {
  id?: string | number;
  customerId?: string;
  customer_id?: string;
  name?: string;
  customerName?: string;
  customer_name?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  billing_email?: string;
  address?: string;
  contact_name?: string;
  payment_terms?: string;
  delivery_notes?: string;
  preferred_delivery_window?: string;
  preferred_door?: string;
  totalOrders?: number | string;
  total_orders?: number | string;
  outstandingBalance?: number | string;
  outstanding_balance?: number | string;
  balance?: number | string;
  status?: string;
  credit_hold?: boolean;
  credit_hold_reason?: string | null;
  credit_hold_placed_at?: string | null;
  created_at?: string;
};

type OrderRecord = {
  id: string;
  order_number?: string;
  status?: string;
  created_at?: string;
  total?: number | string;
  items?: unknown[];
};

type CreateCustomerForm = {
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  payment_terms: string;
};

const emptyCreateCustomerForm: CreateCustomerForm = {
  company_name: '', contact_name: '', email: '', phone: '', address: '', payment_terms: '',
};

const statusColors = { active: 'green', inactive: 'gray', 'on-hold': 'yellow' } as const;

function normalizeStatus(customer: Customer): CustomerStatus {
  if (customer.credit_hold) return 'on-hold';
  const n = String(customer.status || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (n === 'active') return 'active';
  if (n === 'inactive') return 'inactive';
  if (n === 'on-hold') return 'on-hold';
  return 'other';
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function customerId(customer: Customer, index: number): string {
  return String(customer.id || customer.customerId || customer.customer_id || `CUS-${index + 1}`);
}
function customerName(customer: Customer): string {
  return String(customer.company_name || customer.name || customer.customerName || customer.customer_name || '-');
}
function customerEmail(customer: Customer): string {
  return String(customer.email || customer.billing_email || '-');
}
function customerPhone(customer: Customer): string {
  return String(customer.phone || customer.phone_number || '-');
}
function totalOrders(customer: Customer): number {
  return toNumber(customer.totalOrders ?? customer.total_orders);
}
function outstandingBalance(customer: Customer): number {
  return toNumber(customer.outstandingBalance ?? customer.outstanding_balance ?? customer.balance);
}
function orderStatusVariant(status: string): 'success' | 'warning' | 'secondary' | 'neutral' {
  const n = String(status || '').toLowerCase();
  if (n === 'delivered' || n === 'complete' || n === 'completed') return 'success';
  if (n === 'pending') return 'warning';
  if (n === 'in-transit' || n === 'in_process') return 'secondary';
  return 'neutral';
}

type HoldDialogState = { customerId: string; customerName: string } | null;

// ─── Customer Detail Panel ───────────────────────────────────────────────────
function CustomerPanel({
  customer,
  index,
  onClose,
  onRefresh,
  navigate,
}: {
  customer: Customer;
  index: number;
  onClose: () => void;
  onRefresh: () => void;
  navigate: (path: string) => void;
}) {
  const id = customerId(customer, index);
  const name = customerName(customer);

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editForm, setEditForm] = useState({
    company_name: String(customer.company_name || customer.name || customer.customerName || ''),
    contact_name: String(customer.contact_name || ''),
    email: String(customer.email || customer.billing_email || ''),
    phone: String(customer.phone || customer.phone_number || ''),
    address: String(customer.address || ''),
    payment_terms: String(customer.payment_terms || ''),
    delivery_notes: String(customer.delivery_notes || ''),
    preferred_delivery_window: String(customer.preferred_delivery_window || ''),
    preferred_door: String(customer.preferred_door || ''),
  });

  useEffect(() => {
    setOrdersLoading(true);
    fetchWithAuth<OrderRecord[]>(`/api/orders?customerId=${encodeURIComponent(id)}`)
      .then((data) => setOrders(Array.isArray(data) ? data.slice(0, 20) : []))
      .catch(() => setOrders([]))
      .finally(() => setOrdersLoading(false));
  }, [id]);

  function field<K extends keyof typeof editForm>(key: K, val: string) {
    setEditForm((prev) => ({ ...prev, [key]: val }));
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    try {
      await sendWithAuth(`/api/customers/${id}`, 'PATCH', {
        company_name: editForm.company_name.trim() || undefined,
        contact_name: editForm.contact_name.trim() || undefined,
        email: editForm.email.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        address: editForm.address.trim() || undefined,
        payment_terms: editForm.payment_terms.trim() || undefined,
        delivery_notes: editForm.delivery_notes.trim() || undefined,
        preferred_delivery_window: editForm.preferred_delivery_window.trim() || undefined,
        preferred_door: editForm.preferred_door.trim() || undefined,
      });
      setEditing(false);
      onRefresh();
    } catch (err) {
      setSaveError(String((err as Error).message || 'Could not save changes'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-background shadow-2xl border-l border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{name}</h2>
            <p className="text-xs text-muted-foreground">{id}</p>
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Edit2 className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setSaveError(''); }} disabled={saving}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  <Check className="mr-1.5 h-3.5 w-3.5" />{saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
            <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {saveError ? (
          <div className="mx-5 mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{saveError}</div>
        ) : null}

        <div className="space-y-6 p-5">

          {/* Contact Info */}
          <section>
            <SectionTitle icon={Phone} label="Contact Information" />
            {editing ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Company Name" value={editForm.company_name} onChange={(v) => field('company_name', v)} />
                <Field label="Contact Name" value={editForm.contact_name} onChange={(v) => field('contact_name', v)} />
                <Field label="Email" value={editForm.email} onChange={(v) => field('email', v)} />
                <Field label="Phone" value={editForm.phone} onChange={(v) => field('phone', v)} />
                <Field label="Address" value={editForm.address} onChange={(v) => field('address', v)} span2 />
                <Field label="Payment Terms" value={editForm.payment_terms} onChange={(v) => field('payment_terms', v)} />
              </div>
            ) : (
              <dl className="mt-3 grid gap-3 md:grid-cols-2">
                <DetailRow icon={Mail} label="Email" value={customerEmail(customer)} />
                <DetailRow icon={Phone} label="Phone" value={customerPhone(customer)} />
                <DetailRow icon={MapPin} label="Address" value={customer.address || '-'} />
                <DetailRow icon={CreditCard} label="Payment Terms" value={customer.payment_terms || '-'} />
                {customer.contact_name ? <DetailRow icon={Phone} label="Contact" value={customer.contact_name} /> : null}
              </dl>
            )}
          </section>

          {/* Delivery Preferences */}
          <section>
            <SectionTitle icon={Star} label="Saved Delivery Preferences" />
            {editing ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Preferred Delivery Window" value={editForm.preferred_delivery_window} onChange={(v) => field('preferred_delivery_window', v)} placeholder="e.g. 6am–9am" />
                <Field label="Preferred Door" value={editForm.preferred_door} onChange={(v) => field('preferred_door', v)} placeholder="e.g. Back dock" />
                <Field label="Delivery Notes" value={editForm.delivery_notes} onChange={(v) => field('delivery_notes', v)} placeholder="Gate code, contact on arrival, etc." span2 />
              </div>
            ) : (
              <dl className="mt-3 grid gap-3 md:grid-cols-2">
                <DetailRow icon={Star} label="Preferred Window" value={customer.preferred_delivery_window || '-'} />
                <DetailRow icon={MapPin} label="Preferred Door" value={customer.preferred_door || '-'} />
                {customer.delivery_notes ? (
                  <div className="col-span-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Delivery Notes</span>
                    {customer.delivery_notes}
                  </div>
                ) : (
                  <DetailRow icon={ClipboardList} label="Delivery Notes" value="-" />
                )}
              </dl>
            )}
          </section>

          {/* Balance + Status */}
          <section>
            <SectionTitle icon={CreditCard} label="Account Status" />
            <div className="mt-3 flex flex-wrap gap-3">
              <StatPill label="Total Orders" value={totalOrders(customer).toLocaleString()} />
              <StatPill label="Outstanding Balance" value={asMoney(outstandingBalance(customer))} />
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 px-4 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
                <StatusBadge status={normalizeStatus(customer)} colorMap={statusColors} fallbackLabel="Unknown" />
              </div>
              {customer.credit_hold_reason ? (
                <div className="flex-1 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-yellow-600 mb-1">Hold Reason</span>
                  {customer.credit_hold_reason}
                </div>
              ) : null}
            </div>
          </section>

          {/* Order History */}
          <section>
            <div className="flex items-center justify-between">
              <SectionTitle icon={ClipboardList} label="Order History" />
              <Button
                variant="ghost" size="sm"
                onClick={() => navigate(`/orders?customerId=${encodeURIComponent(id)}`)}
                className="text-xs"
              >
                View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
            {ordersLoading ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading orders…</p>
            ) : orders.length ? (
              <div className="mt-3 rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/orders?orderId=${encodeURIComponent(order.id)}`)}>
                        <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                        <TableCell>
                          <Badge variant={orderStatusVariant(order.status || '')}>
                            {order.status || 'unknown'}
                          </Badge>
                        </TableCell>
                        <TableCell>{Array.isArray(order.items) ? order.items.length : '—'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>{order.total ? asMoney(toNumber(order.total)) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/10 px-4 py-5 text-sm text-muted-foreground">
                No orders found for this customer.
              </p>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted/20 px-4 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold text-foreground">{value}</span>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, span2,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; span2?: boolean;
}) {
  return (
    <label className={cn('block space-y-1 text-sm', span2 && 'md:col-span-2')}>
      <span className="font-semibold text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerStatus>('all');
  const [search, setSearch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateCustomerForm>(emptyCreateCustomerForm);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<{ customer: Customer; index: number } | null>(null);

  const [holdDialog, setHoldDialog] = useState<HoldDialogState>(null);
  const [holdReason, setHoldReason] = useState('');
  const [holdSubmitting, setHoldSubmitting] = useState(false);

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

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const status = normalizeStatus(customer);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!needle) return true;
      return (
        customerName(customer).toLowerCase().includes(needle) ||
        customerEmail(customer).toLowerCase().includes(needle) ||
        customerPhone(customer).toLowerCase().includes(needle) ||
        (customer.address || '').toLowerCase().includes(needle) ||
        String(customer.id || customer.customerId || customer.customer_id || '').toLowerCase().includes(needle)
      );
    });
  }, [customers, statusFilter, search]);

  const summary = useMemo(() => {
    const active = customers.filter((c) => normalizeStatus(c) === 'active').length;
    const onHold = customers.filter((c) => c.credit_hold === true).length;
    const outstanding = customers.reduce((sum, c) => sum + outstandingBalance(c), 0);
    return { active, onHold, outstanding };
  }, [customers]);

  function openCreateDialog() { setCreateForm(emptyCreateCustomerForm); setCreateDialogOpen(true); }
  function closeCreateDialog() { setCreateDialogOpen(false); setCreateForm(emptyCreateCustomerForm); }
  function updateCreateForm<K extends keyof CreateCustomerForm>(key: K, value: CreateCustomerForm[K]) {
    setCreateForm((current) => ({ ...current, [key]: value }));
  }

  async function createCustomer() {
    const companyName = createForm.company_name.trim();
    if (!companyName) { setError('Company name is required.'); return; }
    setCreateSubmitting(true);
    setError('');
    try {
      await sendWithAuth('/api/customers', 'POST', {
        company_name: companyName,
        contact_name: createForm.contact_name.trim() || undefined,
        email: createForm.email.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
        address: createForm.address.trim() || undefined,
        payment_terms: createForm.payment_terms.trim() || undefined,
        status: 'active',
      });
      setNotice(`Customer ${companyName} added.`);
      closeCreateDialog();
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not add customer'));
    } finally {
      setCreateSubmitting(false);
    }
  }

  function openHoldDialog(customer: Customer, index: number) {
    setHoldReason('');
    setHoldDialog({ customerId: customerId(customer, index), customerName: customerName(customer) });
  }
  function closeHoldDialog() { setHoldDialog(null); setHoldReason(''); }

  async function placeHold() {
    if (!holdDialog) return;
    setHoldSubmitting(true);
    setError('');
    try {
      await sendWithAuth(`/api/customers/${holdDialog.customerId}/hold`, 'POST', { reason: holdReason.trim() || undefined });
      setNotice(`Credit hold placed on ${holdDialog.customerName}.`);
      closeHoldDialog();
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not place credit hold'));
    } finally {
      setHoldSubmitting(false);
    }
  }

  async function liftHold(customer: Customer, index: number) {
    const id = customerId(customer, index);
    const name = customerName(customer);
    if (!confirm(`Lift credit hold for ${name}?`)) return;
    setError('');
    try {
      await sendWithAuth(`/api/customers/${id}/hold`, 'DELETE');
      setNotice(`Credit hold lifted for ${name}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not lift credit hold'));
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading customers...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      {/* Create Dialog */}
      {createDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-background p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold">Add Customer</h2>
            <p className="text-sm text-muted-foreground">Create a new customer directly from the customer dashboard.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm block"><span className="font-semibold text-muted-foreground">Company Name</span><Input value={createForm.company_name} onChange={(e) => updateCreateForm('company_name', e.target.value)} placeholder="Blue Fin Seafood" autoFocus /></label>
              <label className="space-y-1 text-sm block"><span className="font-semibold text-muted-foreground">Contact Name</span><Input value={createForm.contact_name} onChange={(e) => updateCreateForm('contact_name', e.target.value)} placeholder="Receiving Manager" /></label>
              <label className="space-y-1 text-sm block"><span className="font-semibold text-muted-foreground">Email</span><Input value={createForm.email} onChange={(e) => updateCreateForm('email', e.target.value)} placeholder="ops@example.com" /></label>
              <label className="space-y-1 text-sm block"><span className="font-semibold text-muted-foreground">Phone</span><Input value={createForm.phone} onChange={(e) => updateCreateForm('phone', e.target.value)} placeholder="555-0103" /></label>
              <label className="space-y-1 text-sm block md:col-span-2"><span className="font-semibold text-muted-foreground">Address</span><Input value={createForm.address} onChange={(e) => updateCreateForm('address', e.target.value)} placeholder="123 Dock Street" /></label>
              <label className="space-y-1 text-sm block"><span className="font-semibold text-muted-foreground">Payment Terms</span><Input value={createForm.payment_terms} onChange={(e) => updateCreateForm('payment_terms', e.target.value)} placeholder="Net 30" onKeyDown={(e) => { if (e.key === 'Enter') createCustomer(); if (e.key === 'Escape') closeCreateDialog(); }} /></label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeCreateDialog} disabled={createSubmitting}>Cancel</Button>
              <Button onClick={createCustomer} disabled={createSubmitting}>{createSubmitting ? 'Adding Customer…' : 'Add Customer'}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hold Dialog */}
      {holdDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold">Place Credit Hold</h2>
            <p className="text-sm text-muted-foreground">Placing a credit hold on <strong>{holdDialog.customerName}</strong> will block new orders for this customer.</p>
            <label className="space-y-1 text-sm block"><span className="font-semibold text-muted-foreground">Reason (optional)</span><Input value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="e.g. Overdue balance — 90 days past due" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') placeHold(); if (e.key === 'Escape') closeHoldDialog(); }} /></label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeHoldDialog} disabled={holdSubmitting}>Cancel</Button>
              <Button onClick={placeHold} disabled={holdSubmitting}>{holdSubmitting ? 'Placing Hold…' : 'Place Hold'}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Customer Detail Panel */}
      {selectedCustomer ? (
        <CustomerPanel
          customer={selectedCustomer.customer}
          index={selectedCustomer.index}
          onClose={() => setSelectedCustomer(null)}
          onRefresh={() => { void load(); }}
          navigate={navigate}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Customers" value={customers.length.toLocaleString()} />
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="On Credit Hold" value={summary.onHold.toLocaleString()} />
        <SummaryCard label="Outstanding Balance" value={asMoney(summary.outstanding)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Customers Workbench</CardTitle>
            <CardDescription>Search and manage customer accounts, contact info, order history, and delivery preferences.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button onClick={openCreateDialog}>Add Customer</Button>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | CustomerStatus)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on-hold">On Hold</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email, phone, address, or ID"
                className="min-w-[240px]"
              />
            </label>
            <Button variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Total Orders</TableHead>
                <TableHead>Outstanding Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((customer, index) => {
                  const id = customerId(customer, index);
                  const onHold = customer.credit_hold === true;
                  const status = normalizeStatus(customer);
                  return (
                    <TableRow
                      key={id}
                      className={cn('cursor-pointer', onHold ? 'bg-yellow-50/60' : undefined)}
                      onClick={() => setSelectedCustomer({ customer, index })}
                    >
                      <TableCell className="font-medium">{id}</TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground">{customerName(customer)}</span>
                        {onHold && customer.credit_hold_reason ? (
                          <p className="text-xs text-yellow-700 mt-0.5">{customer.credit_hold_reason}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>{customerEmail(customer)}</TableCell>
                      <TableCell>{customerPhone(customer)}</TableCell>
                      <TableCell>{customer.address || '-'}</TableCell>
                      <TableCell>{totalOrders(customer).toLocaleString()}</TableCell>
                      <TableCell>{asMoney(outstandingBalance(customer))}</TableCell>
                      <TableCell><StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1">
                          {onHold ? (
                            <Button variant="outline" size="sm" className="border-yellow-400 text-yellow-700 hover:bg-yellow-50" onClick={() => liftHold(customer, index)}>Lift Hold</Button>
                          ) : (
                            <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50" onClick={() => openHoldDialog(customer, index)}>Place Hold</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">No customers found for the selected filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
