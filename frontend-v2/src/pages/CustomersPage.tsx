import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type CustomerStatus = 'active' | 'inactive' | 'on-hold' | 'other';

type Customer = {
  id?: string | number;
  customerId?: string;
  customer_id?: string;
  name?: string;
  customerName?: string;
  customer_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  totalOrders?: number | string;
  total_orders?: number | string;
  outstandingBalance?: number | string;
  outstanding_balance?: number | string;
  balance?: number | string;
  status?: string;
};

const statusColors = {
  active: 'green',
  inactive: 'gray',
  'on-hold': 'yellow',
} as const;

function normalizeStatus(value: string | undefined): CustomerStatus {
  const normalized = String(value || '')
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
  return String(customer.customerId || customer.customer_id || customer.id || `CUS-${index + 1}`);
}

function customerName(customer: Customer): string {
  return String(customer.name || customer.customerName || customer.customer_name || '-');
}

function totalOrders(customer: Customer): number {
  return toNumber(customer.totalOrders ?? customer.total_orders);
}

function outstandingBalance(customer: Customer): number {
  return toNumber(customer.outstandingBalance ?? customer.outstanding_balance ?? customer.balance);
}

export function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerStatus>('all');
  const [search, setSearch] = useState('');

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
      const status = normalizeStatus(customer.status);
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
    const active = customers.filter((customer) => normalizeStatus(customer.status) === 'active').length;
    const onHold = customers.filter((customer) => normalizeStatus(customer.status) === 'on-hold').length;
    const outstanding = customers.reduce((sum, customer) => sum + outstandingBalance(customer), 0);
    return { active, onHold, outstanding };
  }, [customers]);

  function viewOrders(customer: Customer, index: number) {
    navigate(`/orders?customerId=${encodeURIComponent(customerId(customer, index))}`);
  }

  function viewInvoices(customer: Customer, index: number) {
    navigate(`/invoices?customerId=${encodeURIComponent(customerId(customer, index))}`);
  }

  function editCustomer(customer: Customer, index: number) {
    setNotice(`Customer editor opened for ${customerName(customer)} (${customerId(customer, index)}).`);
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading customers...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Customers" value={customers.length.toLocaleString()} />
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="On Hold" value={summary.onHold.toLocaleString()} />
        <SummaryCard label="Outstanding Balance" value={asMoney(summary.outstanding)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Customers Workbench</CardTitle>
            <CardDescription>Customer account and billing visibility from `/api/customers`.</CardDescription>
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
                  const status = normalizeStatus(customer.status);
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">{id}</TableCell>
                      <TableCell>{customerName(customer)}</TableCell>
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
                          <Button size="sm" onClick={() => editCustomer(customer, index)}>
                            Edit Customer
                          </Button>
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
