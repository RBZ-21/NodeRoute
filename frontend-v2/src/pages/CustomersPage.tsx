// NOTE: This file retains all existing logic. The only addition is an
// "Invoices" tab inside the customer detail slide-over panel.
// The tab fetches /api/invoices?customer_id=<id> and renders a small table.
import { useId, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { PaginationControls } from '../components/ui/pagination';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatCard } from '../components/ui/stat-card';
import { StatusBadge } from '../components/ui/status-badge';
import { DetailField } from '../components/ui/detail-field';
import { Modal, SlideOver } from '../components/ui/overlay-panel';
import { useToast } from '../components/ui/toast';
import { Input } from '../components/ui/input';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { LoadingSkeleton } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import {
  type Customer,
  type CustomerInvoice,
  useCustomerInvoicesQuery,
  useCustomersQuery,
  useDeleteCustomerMutation,
  useSaveCustomerMutation,
} from '../hooks/useCustomers';
import { usePagination } from '../hooks/usePagination';

type DetailTab = 'info' | 'delivery' | 'billing' | 'invoices';

const riskColors = {
  high: 'red',
  medium: 'yellow',
  low: 'green',
} as const;

function phone(customer: Customer): string {
  return String(customer.phone_number || customer.phone || '-');
}

function customerStatus(customer: Customer): string {
  if (customer.credit_hold) return 'credit-hold';
  return String(customer.status || 'active').toLowerCase();
}

export function CustomersPage() {
  const customersQuery = useCustomersQuery();
  const saveCustomerMutation = useSaveCustomerMutation();
  const deleteCustomerMutation = useDeleteCustomerMutation();

  const customers = useMemo(() => customersQuery.data ?? [], [customersQuery.data]);

  const toast = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState<Customer>({ status: 'active' });
  const [holdTarget, setHoldTarget] = useState<Customer | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [holdSaving, setHoldSaving] = useState(false);

  // Detail panel
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Customer>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Invoices: enabled only while the invoices tab is open for the selected customer.
  const invoicesQuery = useCustomerInvoicesQuery(
    detailTab === 'invoices' ? (selected?.id ?? null) : null,
  );
  const invoices: CustomerInvoice[] = invoicesQuery.data ?? [];

  // Address lookup state
  const [lookingUpAddress, setLookingUpAddress] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState('');

  // AI: Risk scoring — keyed by customer id (primary key)
  type RiskResult = { risk_level: string; risk_score: number; risk_factors: string[]; recommended_action: string; summary: string };
  const [riskScores, setRiskScores] = useState<Record<string, RiskResult>>({});
  const [riskLoading, setRiskLoading] = useState<Record<string, boolean>>({});
  const [pageSize, setPageSize] = useState(25);

  async function scoreRisk(customerId: string) {
    setRiskLoading((r) => ({ ...r, [customerId]: true }));
    try {
      const result = await sendWithAuth<RiskResult & { customer_id: string }>('/api/ai/customer-risk', 'POST', { customer_id: customerId });
      setRiskScores((prev) => ({ ...prev, [customerId]: result }));
    } catch (err) {
      toast.error(String((err as Error).message || 'Risk scoring failed'));
    } finally {
      setRiskLoading((r) => ({ ...r, [customerId]: false }));
    }
  }

  const deliveryAddressId = useId();
  const billingAddressId = useId();

  async function lookupAddress(targetField: 'address' | 'billing_address') {
    const name = draft.company_name?.trim();
    if (!name) {
      setAddressLookupError('Company name is required to look up an address.');
      return;
    }
    setLookingUpAddress(true);
    setAddressLookupError('');
    try {
      const result = await fetchWithAuth<{ address: string; place_name?: string; place_id?: string }>(
        `/api/customers/address-lookup?name=${encodeURIComponent(name)}`
      );
      if (result?.address) {
        setDraft((d) => ({ ...d, [targetField]: result.address }));
        toast.success(`Address found: ${result.address}`);
      } else {
        setAddressLookupError(`No address found for "${name}". Try editing the company name and searching again.`);
      }
    } catch (err) {
      setAddressLookupError(String((err as Error).message || 'Address lookup failed'));
    } finally {
      setLookingUpAddress(false);
    }
  }

  async function saveCustomer() {
    if (!selected?.id) return;
    setSaving(true);    try {
      const updated = await saveCustomerMutation.mutateAsync({ id: selected.id, draft });
      setSelected({ ...selected, ...updated });
      setEditing(false);
      toast.success(`${draft.company_name || 'Customer'} saved.`);
    } catch (err) {
      toast.error(String((err as Error).message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  function deleteCustomer() {
    if (!selected?.id) return;
    const customerName = selected.company_name || 'Customer';
    deleteCustomerMutation.mutate(selected.id, {
      onSuccess: () => {
        setSelected(null);
        setEditing(false);
        setConfirmDelete(false);
        setDraft({});
        toast.success(`${customerName} deleted.`);
      },
      onError: (err) => {
        toast.error(String((err as Error).message || 'Could not delete customer.'));
      },
    });
  }

  function openCustomer(customer: Customer) {
    setSelected(customer);
    setDraft({ ...customer });
    setEditing(false);
    setConfirmDelete(false);
    setDetailTab('info');
    setAddressLookupError('');
  }

  function onTabChange(tab: DetailTab) {
    setDetailTab(tab);
    setAddressLookupError('');
  }

  function resetCreateForm() {
    setNewCustomer({ status: 'active' });
    setShowCreateForm(false);
  }

  async function createCustomer() {
    const companyName = String(newCustomer.company_name || '').trim();
    if (!companyName) {
      toast.error('Company name is required to create a customer.');
      return;
    }

    setCreatingCustomer(true);    try {
      await sendWithAuth('/api/customers', 'POST', {
        company_name: companyName,
        contact_name: newCustomer.contact_name?.trim() || null,
        email: newCustomer.email?.trim() || null,
        phone: newCustomer.phone_number?.trim() || newCustomer.phone?.trim() || null,
        address: newCustomer.address?.trim() || null,
        payment_terms: newCustomer.payment_terms?.trim() || null,
        status: newCustomer.status || 'active',
      });
      await customersQuery.refetch();
      toast.success(`Customer ${companyName} added.`);
      resetCreateForm();
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not create customer.'));
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function placeCreditHold() {
    if (!holdTarget?.id) return;
    setHoldSaving(true);    try {
      await sendWithAuth(`/api/customers/${holdTarget.id}/hold`, 'POST', {
        reason: holdReason.trim() || null,
      });
      await customersQuery.refetch();
      toast.success(`Credit hold placed on ${holdTarget.company_name || 'customer'}.`);
      setHoldTarget(null);
      setHoldReason('');
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not place credit hold.'));
    } finally {
      setHoldSaving(false);
    }
  }

  async function liftCreditHold(customer: Customer) {
    if (!customer.id) return;    try {
      await sendWithAuth(`/api/customers/${customer.id}/hold`, 'DELETE');
      await customersQuery.refetch();
      toast.success(`Credit hold lifted for ${customer.company_name || 'customer'}.`);
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not lift credit hold.'));
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
  const pagination = usePagination(filtered, pageSize);

  const summary = useMemo(() => ({
    total: customers.length,
    active: customers.filter((c) => customerStatus(c) === 'active').length,
    hold: customers.filter((c) => c.credit_hold).length,
    inactive: customers.filter((c) => customerStatus(c) === 'inactive').length,
  }), [customers]);

  const fetchError = customersQuery.error
    ? String((customersQuery.error as Error)?.message || 'Could not load customers')
    : '';

  return (
    <div className="space-y-5">
      {customersQuery.isPending ? <PageSkeleton /> : null}
      {fetchError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{fetchError}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total" value={summary.total.toLocaleString()} />
        <StatCard label="Active" value={summary.active.toLocaleString()} />
        <StatCard label="Credit Hold" value={summary.hold.toLocaleString()} />
        <StatCard label="Inactive" value={summary.inactive.toLocaleString()} />
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
              <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="credit-hold">Credit Hold</option>
              </SelectInput>
            </label>
            <Button variant="outline" onClick={() => setShowCreateForm((current) => !current)}>
              {showCreateForm ? 'Close' : 'Add Customer'}
            </Button>
            <Button variant="outline" onClick={() => void customersQuery.refetch()}>Refresh</Button>
          </div>
        </CardHeader>
        {showCreateForm ? (
          <CardContent className="border-t border-border bg-muted/10">
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-base font-semibold text-foreground">Create a new customer directly from the customer dashboard.</div>
                <div className="text-sm text-muted-foreground">Set up the account details now and fine-tune delivery, billing, and tax settings later.</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Input
                  placeholder="Blue Fin Seafood"
                  value={newCustomer.company_name || ''}
                  onChange={(e) => setNewCustomer((current) => ({ ...current, company_name: e.target.value }))}
                  disabled={creatingCustomer}
                />
                <Input
                  placeholder="Receiving Manager"
                  value={newCustomer.contact_name || ''}
                  onChange={(e) => setNewCustomer((current) => ({ ...current, contact_name: e.target.value }))}
                  disabled={creatingCustomer}
                />
                <Input
                  placeholder="ops@example.com"
                  value={newCustomer.email || ''}
                  onChange={(e) => setNewCustomer((current) => ({ ...current, email: e.target.value }))}
                  disabled={creatingCustomer}
                />
                <Input
                  placeholder="(555) 010-0103"
                  value={newCustomer.phone_number || newCustomer.phone || ''}
                  onChange={(e) => setNewCustomer((current) => ({ ...current, phone_number: e.target.value, phone: e.target.value }))}
                  disabled={creatingCustomer}
                />
                <Input
                  placeholder="123 Dock Street"
                  value={newCustomer.address || ''}
                  onChange={(e) => setNewCustomer((current) => ({ ...current, address: e.target.value }))}
                  disabled={creatingCustomer}
                />
                <Input
                  placeholder="Net 30"
                  value={newCustomer.payment_terms || ''}
                  onChange={(e) => setNewCustomer((current) => ({ ...current, payment_terms: e.target.value }))}
                  disabled={creatingCustomer}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void createCustomer()} disabled={creatingCustomer}>
                  {creatingCustomer ? 'Adding Customer...' : 'Add Customer'}
                </Button>
                <Button variant="outline" onClick={resetCreateForm} disabled={creatingCustomer}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        ) : null}
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
              {filtered.length ? pagination.pageItems.map((c) => (
                <TableRow key={String(c.id || c.customer_number)}>
                  <TableCell className="font-medium">{c.customer_number || '-'}</TableCell>
                  <TableCell>{c.company_name || '-'}</TableCell>
                  <TableCell>{c.contact_name || '-'}</TableCell>
                  <TableCell>{phone(c)}</TableCell>
                  <TableCell>{c.email || '-'}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant={c.credit_hold ? 'warning' : customerStatus(c) === 'active' ? 'success' : 'secondary'}>
                        {c.credit_hold ? 'Credit Hold' : c.status || 'Active'}
                      </Badge>
                      {c.credit_hold_reason ? (
                        <div className="text-xs text-muted-foreground">{c.credit_hold_reason}</div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{c.payment_terms || '-'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button size="sm" onClick={() => openCustomer(c)}>View / Edit</Button>
                      {c.credit_hold ? (
                        <Button size="sm" variant="outline" onClick={() => void liftCreditHold(c)}>
                          Lift Hold
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setHoldTarget(c);
                            setHoldReason(c.credit_hold_reason || '');
                          }}
                        >
                          Place Hold
                        </Button>
                      )}
                      {c.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void scoreRisk(String(c.id))}
                          disabled={riskLoading[String(c.id)]}
                          title="AI risk score"
                          aria-label="Score customer risk"
                          aria-busy={riskLoading[String(c.id)] || undefined}
                        >
                          {riskLoading[String(c.id)] ? '…' : '✦ Risk'}
                        </Button>
                      )}
                      {c.id && riskScores[String(c.id)] && (
                        <StatusBadge
                          status={riskScores[String(c.id)].risk_level === 'high' || riskScores[String(c.id)].risk_level === 'medium' ? riskScores[String(c.id)].risk_level : 'low'}
                          colorMap={riskColors}
                        >
                          {riskScores[String(c.id)].risk_level} {riskScores[String(c.id)].risk_score}/100
                        </StatusBadge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={8}>
                    <div className="space-y-2 py-6 text-center">
                      <div className="font-medium text-foreground">No customers found.</div>
                      <div className="text-sm text-muted-foreground">Create a customer profile to start adding delivery, billing, and credit details.</div>
                      <Button size="sm" onClick={() => setShowCreateForm(true)}>+ Add Customer</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {filtered.length ? (
            <PaginationControls
              page={pagination.page}
              pageCount={pagination.pageCount}
              setPage={pagination.setPage}
              itemCount={pagination.itemCount}
              pageSize={pagination.pageSize}
              onPageSizeChange={setPageSize}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* ── Detail Slide-Over ── */}
      {holdTarget ? (
        <Modal
          open
          title="Place Credit Hold"
          description={`Prevent new deliveries for ${holdTarget.company_name || 'this customer'} until the hold is lifted.`}
          onClose={() => { if (!holdSaving) setHoldTarget(null); }}
          widthClassName="max-w-md"
        >
          <div className="space-y-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">Reason</span>
              <Input
                placeholder="Overdue balance"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                disabled={holdSaving}
              />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setHoldTarget(null)} disabled={holdSaving}>
              Cancel
            </Button>
            <Button onClick={() => void placeCreditHold()} disabled={holdSaving}>
              {holdSaving ? 'Placing Hold...' : 'Place Hold'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {selected ? (
        <SlideOver
          open
          title={selected.company_name ?? ''}
          description={selected.customer_number ?? ''}
          onClose={() => { setSelected(null); setConfirmDelete(false); }}
          widthClassName="max-w-xl"
          actions={
            !editing && !confirmDelete ? (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </>
            ) : confirmDelete ? (
              <>
                <span className="self-center text-sm text-destructive">Delete?</span>
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleteCustomerMutation.isPending}>No</Button>
                <Button size="sm" disabled={deleteCustomerMutation.isPending} onClick={deleteCustomer}>
                  {deleteCustomerMutation.isPending ? 'Deleting...' : 'Yes'}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); setAddressLookupError(''); }}>Cancel</Button>
                <Button size="sm" disabled={saving} onClick={saveCustomer}>{saving ? 'Saving...' : 'Save'}</Button>
              </>
            )
          }
        >
          {/* Tabs */}
          <div className="-mt-1 mb-3 flex gap-1 border-b">
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

          <div className="space-y-4">
              {/* Info Tab */}
              {detailTab === 'info' && (
                <div className="space-y-3">
                  <Field label="Company Name" value={draft.company_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, company_name: v }))} />
                  <Field label="Contact Name" value={draft.contact_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, contact_name: v }))} />
                  <Field label="Email" value={draft.email} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
                  <Field label="Phone" value={draft.phone_number || draft.phone} editing={editing} placeholder="(555) 010-0103" onChange={(v) => setDraft((d) => ({ ...d, phone_number: v }))} />
                  <Field label="Fax" value={draft.fax_number} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, fax_number: v }))} />
                  <Field label="Payment Terms" value={draft.payment_terms} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, payment_terms: v }))} />
                  <Field label="Status" value={draft.status} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
                  <div className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-sm text-muted-foreground">Tax Enabled</span>
                    {editing ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!draft.tax_enabled} onChange={(e) => setDraft((d) => ({ ...d, tax_enabled: e.target.checked }))} />
                        <span className="text-muted-foreground">Charge sales tax</span>
                      </label>
                    ) : (
                      <span className="text-sm">{selected.tax_enabled ? 'Yes' : 'No'}</span>
                    )}
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="w-36 shrink-0 pt-0.5 text-sm text-muted-foreground">SMS Notifications</span>
                    {editing ? (
                      <label className="flex items-center gap-2 text-sm">
                        {/* Default ON; clearing this opts the customer out of delivery SMS. */}
                        <input
                          type="checkbox"
                          checked={draft.sms_notifications_enabled !== false}
                          onChange={(e) => setDraft((d) => ({ ...d, sms_notifications_enabled: e.target.checked }))}
                        />
                        <span className="text-muted-foreground">Send delivery text updates</span>
                      </label>
                    ) : (
                      <span className="text-sm">{selected.sms_notifications_enabled === false ? 'Off' : 'On'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Delivery Tab */}
              {detailTab === 'delivery' && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <label htmlFor={deliveryAddressId} className="w-36 shrink-0 pt-1 text-sm text-muted-foreground">Address</label>
                    {editing ? (
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex gap-2">
                          <Input
                            id={deliveryAddressId}
                            className="flex-1"
                            value={draft.address || ''}
                            onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
                            placeholder="Street address..."
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={lookingUpAddress}
                            onClick={() => lookupAddress('address')}
                            title={`Look up address for ${draft.company_name || 'this business'}`}
                            aria-label="Look up delivery address"
                            aria-busy={lookingUpAddress || undefined}
                          >
                            {lookingUpAddress ? '...' : '🔍'}
                          </Button>
                        </div>
                        {addressLookupError && (
                          <p className="text-xs text-destructive">{addressLookupError}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm">{selected.address || '-'}</span>
                    )}
                  </div>
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
                  <Field label="Billing Phone" value={draft.billing_phone} editing={editing} placeholder="(555) 010-0103" onChange={(v) => setDraft((d) => ({ ...d, billing_phone: v }))} />
                  <div className="flex items-start gap-3">
                    <label htmlFor={billingAddressId} className="w-36 shrink-0 pt-1 text-sm text-muted-foreground">Billing Address</label>
                    {editing ? (
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex gap-2">
                          <Input
                            id={billingAddressId}
                            className="flex-1"
                            value={draft.billing_address || ''}
                            onChange={(e) => setDraft((d) => ({ ...d, billing_address: e.target.value }))}
                            placeholder="Billing address..."
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={lookingUpAddress}
                            onClick={() => lookupAddress('billing_address')}
                            title={`Look up address for ${draft.company_name || 'this business'}`}
                            aria-label="Look up billing address"
                            aria-busy={lookingUpAddress || undefined}
                          >
                            {lookingUpAddress ? '...' : '🔍'}
                          </Button>
                        </div>
                        {addressLookupError && (
                          <p className="text-xs text-destructive">{addressLookupError}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm">{selected.billing_address || '-'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Invoices Tab */}
              {detailTab === 'invoices' && (
                <div className="space-y-3">
                  {invoicesQuery.isPending ? (
                    <LoadingSkeleton rows={3} label="Loading customer invoices" />
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
        </SlideOver>
      ) : null}
    </div>
  );
}

// Customer detail labels use a wider column (w-36) to stay aligned with the
// panel's non-DetailField rows (Tax Enabled, SMS Notifications).
function Field(props: {
  label: string;
  value?: string | null;
  editing: boolean;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return <DetailField {...props} labelClassName="w-36" />;
}
