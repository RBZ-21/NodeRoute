import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

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
  address?: string;
  totalOrders?: number | string;
  total_orders?: number | string;
  outstandingBalance?: number | string;
  outstanding_balance?: number | string;
  balance?: number | string;
  status?: string;
  credit_hold?: boolean;
  credit_hold_reason?: string | null;
  credit_hold_placed_at?: string | null;
};

const statusColors = {
  active: 'green',
  inactive: 'gray',
  'on-hold': 'yellow',
} as const;

function normalizeStatus(customer: Customer): CustomerStatus {
  if (customer.credit_hold) return 'on-hold';
  const normalized = String(customer.status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'active') return 'active';
  if (normalized === 'inactive') return 'inactive';
  if (normalized === 'on-hold') return 'on-hold';
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

function totalOrders(customer: Customer): number {
  return toNumber(customer.totalOrders ?? customer.total_orders);
}

function outstandingBalance(customer: Customer): number {
  return toNumber(customer.outstandingBalance ?? customer.outstanding_balance ?? customer.balance);
}

type HoldDialogState = { customerId: string; customerName: string } | null;

export function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerStatus>('all');
  const [search, setSearch] = useState('');

  // Hold dialog state
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

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const status = normalizeStatus(customer);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!needle) return true;
      return (
        customerName(customer).toLowerCase().includes(needle) ||
        String(customer.email || '')
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [customers, statusFilter, search]);

  const summary = useMemo(() => {
    const active = customers.filter((c) => normalizeStatus(c) === 'active').length;
    const onHold = customers.filter((c) => c.credit_hold === true).length;
    const outstanding = customers.reduce((sum, c) => sum + outstandingBalance(c), 0);
    return { active, onHold, outstanding };
  }, [customers]);

  function viewOrders(customer: Customer, index: number) {
    navigate(`/orders?customerId=${encodeURIComponent(customerId(customer, index))}`);
  }

  function viewInvoices(customer: Customer, index: number) {
    navigate(`/invoices?customerId=${encodeURIComponent(customerId(customer, index))}`);
  }

  function openHoldDialog(customer: Customer, index: number) {
    setHoldReason('');
    setHoldDialog({ customerId: customerId(customer, index), customerName: customerName(customer) });
  }

  function closeHoldDialog() {
    setHoldDialog(null);
    setHoldReason('');
  }

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

      {/* Credit Hold Dialog */}
      {holdDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold">Place Credit Hold</h2>
            <p className="text-sm text-muted-foreground">
              Placing a credit hold on <strong>{holdDialog.customerName}</strong> will block new orders for this customer.
            </p>
            <label className="space-y-1 text-sm block">
              <span className="font-semibold text-muted-foreground">Reason (optional)</span>
              <Input
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="e.g. Overdue balance — 90 days past due"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') placeHold(); if (e.key === 'Escape') closeHoldDialog(); }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeHoldDialog} disabled={holdSubmitting}>Cancel</Button>
              <Button onClick={placeHold} disabled={holdSubmitting}>
                {holdSubmitting ? 'Placing Hold…' : 'Place Hold'}
              </Button>
            </div>
          </div>
        </div>
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
            <CardDescription>Manage customer accounts and credit holds.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | CustomerStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on-hold">On Hold</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" />
            </label>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
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
                  const status = normalizeStatus(customer);
                  const onHold = customer.credit_hold === true;
                  return (
                    <TableRow key={id} className={onHold ? 'bg-yellow-50/60' : undefined}>
                      <TableCell className="font-medium">{id}</TableCell>
                      <TableCell>
                        <span>{customerName(customer)}</span>
                        {onHold && customer.credit_hold_reason ? (
                          <p className="text-xs text-yellow-700 mt-0.5">{customer.credit_hold_reason}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>{customer.email || '-'}</TableCell>
                      <TableCell>{customer.phone || '-'}</TableCell>
                      <TableCell>{customer.address || '-'}</TableCell>
                      <TableCell>{totalOrders(customer).toLocaleString()}</TableCell>
                      <TableCell>{asMoney(outstandingBalance(customer))}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => viewOrders(customer, index)}>
                            View Orders
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => viewInvoices(customer, index)}>
                            View Invoices
                          </Button>
                          {onHold ? (
                            <Button variant="outline" size="sm" className="border-yellow-400 text-yellow-700 hover:bg-yellow-50" onClick={() => liftHold(customer, index)}>
                              Lift Hold
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50" onClick={() => openHoldDialog(customer, index)}>
                              Place Hold
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    No customers found for the selected filters.
                  </TableCell>
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
