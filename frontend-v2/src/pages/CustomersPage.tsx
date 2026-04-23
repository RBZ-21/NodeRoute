import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type Customer = {
  id: string;
  customer_number?: string;
  company_name?: string;
  phone_number?: string;
  fax_number?: string;
  contact_name?: string;
  payment_terms?: string;
  address?: string;
  billing_name?: string;
  billing_contact?: string;
  billing_email?: string;
  billing_phone?: string;
  billing_address?: string;
  tax_enabled?: boolean;
};

type CustomerForm = {
  customer_number: string;
  company_name: string;
  phone_number: string;
  fax_number: string;
  contact_name: string;
  payment_terms: string;
  address: string;
  billing_name: string;
  billing_contact: string;
  billing_email: string;
  billing_phone: string;
  billing_address: string;
  tax_enabled: boolean;
};

function emptyForm(): CustomerForm {
  return {
    customer_number: '',
    company_name: '',
    phone_number: '',
    fax_number: '',
    contact_name: '',
    payment_terms: '',
    address: '',
    billing_name: '',
    billing_contact: '',
    billing_email: '',
    billing_phone: '',
    billing_address: '',
    tax_enabled: false,
  };
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm());

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
    if (!needle) return customers;
    return customers.filter((customer) =>
      [
        customer.customer_number,
        customer.company_name,
        customer.contact_name,
        customer.phone_number,
        customer.fax_number,
        customer.payment_terms,
        customer.address,
        customer.billing_name,
        customer.billing_contact,
        customer.billing_email,
        customer.billing_phone,
        customer.billing_address,
      ]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle))
    );
  }, [customers, search]);

  const summary = useMemo(() => {
    const taxable = customers.filter((customer) => !!customer.tax_enabled).length;
    const withBilling = customers.filter((customer) => !!(customer.billing_name || customer.billing_email || customer.billing_contact)).length;
    return { taxable, withBilling };
  }, [customers]);

  function resetForm() {
    setEditingCustomerId(null);
    setForm(emptyForm());
  }

  function editCustomer(customer: Customer) {
    setEditingCustomerId(customer.id);
    setForm({
      customer_number: customer.customer_number || '',
      company_name: customer.company_name || '',
      phone_number: customer.phone_number || '',
      fax_number: customer.fax_number || '',
      contact_name: customer.contact_name || '',
      payment_terms: customer.payment_terms || '',
      address: customer.address || '',
      billing_name: customer.billing_name || '',
      billing_contact: customer.billing_contact || '',
      billing_email: customer.billing_email || '',
      billing_phone: customer.billing_phone || '',
      billing_address: customer.billing_address || '',
      tax_enabled: !!customer.tax_enabled,
    });
    setNotice(`Editing ${customer.company_name || customer.id.slice(0, 8)}.`);
  }

  async function submitCustomer() {
    const companyName = form.company_name.trim();
    if (!companyName) {
      setError('Company name is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        customer_number: form.customer_number.trim() || null,
        company_name: companyName,
        phone_number: form.phone_number.trim() || null,
        fax_number: form.fax_number.trim() || null,
        contact_name: form.contact_name.trim() || null,
        payment_terms: form.payment_terms.trim() || null,
        address: form.address.trim() || null,
        billing_name: form.billing_name.trim() || null,
        billing_contact: form.billing_contact.trim() || null,
        billing_email: form.billing_email.trim() || null,
        billing_phone: form.billing_phone.trim() || null,
        billing_address: form.billing_address.trim() || null,
        tax_enabled: form.tax_enabled,
      };
      if (editingCustomerId) {
        await sendWithAuth<Customer>(`/api/customers/${editingCustomerId}`, 'PATCH', payload);
        setNotice('Customer updated.');
      } else {
        await sendWithAuth<Customer>('/api/customers', 'POST', payload);
        setNotice('Customer added.');
      }
      resetForm();
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not save customer'));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteCustomer(customer: Customer) {
    if (!confirm(`Delete ${customer.company_name || customer.id.slice(0, 8)}?`)) return;
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/customers/${customer.id}`, 'DELETE');
      if (editingCustomerId === customer.id) resetForm();
      setNotice(`Deleted ${customer.company_name || customer.id.slice(0, 8)}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete customer'));
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading customers...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Customers" value={customers.length.toLocaleString()} />
        <SummaryCard label="Retail Tax Enabled" value={summary.taxable.toLocaleString()} />
        <SummaryCard label="Billing Profiles" value={summary.withBilling.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editingCustomerId ? 'Edit Customer' : 'Add Customer'}</CardTitle>
          <CardDescription>Customer onboarding and billing profile parity in v2.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input
            value={form.company_name}
            onChange={(event) => setForm((current) => ({ ...current, company_name: event.target.value }))}
            placeholder="Company name"
          />
          <Input
            value={form.customer_number}
            onChange={(event) => setForm((current) => ({ ...current, customer_number: event.target.value }))}
            placeholder="Customer #"
          />
          <Input
            value={form.contact_name}
            onChange={(event) => setForm((current) => ({ ...current, contact_name: event.target.value }))}
            placeholder="Primary contact"
          />
          <Input
            value={form.phone_number}
            onChange={(event) => setForm((current) => ({ ...current, phone_number: event.target.value }))}
            placeholder="Phone"
          />
          <Input
            value={form.address}
            onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
            placeholder="Address"
            className="md:col-span-2"
          />
          <Input
            value={form.payment_terms}
            onChange={(event) => setForm((current) => ({ ...current, payment_terms: event.target.value }))}
            placeholder="Payment terms"
          />
          <label className="flex items-center gap-2 rounded-md border border-border px-3 text-sm">
            <input
              type="checkbox"
              checked={form.tax_enabled}
              onChange={(event) => setForm((current) => ({ ...current, tax_enabled: event.target.checked }))}
            />
            Retail tax enabled
          </label>
          <Input
            value={form.billing_name}
            onChange={(event) => setForm((current) => ({ ...current, billing_name: event.target.value }))}
            placeholder="Billing name"
          />
          <Input
            value={form.billing_contact}
            onChange={(event) => setForm((current) => ({ ...current, billing_contact: event.target.value }))}
            placeholder="Billing contact"
          />
          <Input
            value={form.billing_email}
            onChange={(event) => setForm((current) => ({ ...current, billing_email: event.target.value }))}
            placeholder="Billing email"
          />
          <Input
            value={form.billing_phone}
            onChange={(event) => setForm((current) => ({ ...current, billing_phone: event.target.value }))}
            placeholder="Billing phone"
          />
          <Input
            value={form.billing_address}
            onChange={(event) => setForm((current) => ({ ...current, billing_address: event.target.value }))}
            placeholder="Billing address"
            className="md:col-span-2"
          />
          <div className="md:col-span-2 flex gap-2">
            <Button onClick={submitCustomer} disabled={submitting}>
              {editingCustomerId ? 'Save Customer' : 'Add Customer'}
            </Button>
            {editingCustomerId ? (
              <Button variant="ghost" onClick={resetForm}>
                Cancel Edit
              </Button>
            ) : null}
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Customers</CardTitle>
            <CardDescription>Search and manage customer records.</CardDescription>
          </div>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, contact, terms, billing" />
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>{customer.customer_number || '-'}</TableCell>
                    <TableCell className="font-medium">{customer.company_name || '-'}</TableCell>
                    <TableCell>{customer.contact_name || '-'}</TableCell>
                    <TableCell>{customer.phone_number || '-'}</TableCell>
                    <TableCell>{customer.billing_name || customer.billing_email || customer.billing_contact || '-'}</TableCell>
                    <TableCell>{customer.payment_terms || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={customer.tax_enabled ? 'success' : 'neutral'}>{customer.tax_enabled ? 'Retail' : 'Off'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => editCustomer(customer)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteCustomer(customer)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No customers match the current search.
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
