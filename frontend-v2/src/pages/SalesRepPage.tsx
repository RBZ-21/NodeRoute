import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type Customer = {
  id: string | number;
  company_name?: string;
  email?: string;
  phone_number?: string;
  address?: string;
  payment_terms?: string;
  sales_rep_id?: string;
};

type VisitLog = {
  id: string;
  customer_name?: string;
  sales_rep_name?: string;
  notes?: string;
  outcome?: string;
  visited_at?: string;
};

type UpsellAlert = {
  customer_id: string | number;
  customer_name?: string;
  missing_items: string[];
  alert: string;
};

type Order = {
  id: string;
  created_at?: string;
  status?: string;
  total?: number | string;
  items?: { description?: string; quantity?: number; total?: number }[];
};

type Tab = 'customers' | 'visits' | 'upsell' | 'history';

const OUTCOMES = ['order_placed', 'follow_up', 'no_answer', 'demo', 'other'];

function money(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function SalesRepPage() {
  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [visits, setVisits] = useState<VisitLog[]>([]);
  const [alerts, setAlerts] = useState<UpsellAlert[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Visit log form state
  const [visitCustomerId, setVisitCustomerId] = useState('');
  const [visitCustomerName, setVisitCustomerName] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [visitOutcome, setVisitOutcome] = useState(OUTCOMES[0]);

  async function load(t: Tab = tab) {
    setLoading(true);
    setError('');
    try {
      if (t === 'customers') {
        const data = await fetchWithAuth<Customer[]>('/api/sales-reps/customers');
        setCustomers(Array.isArray(data) ? data : []);
      } else if (t === 'visits') {
        const data = await fetchWithAuth<VisitLog[]>('/api/sales-reps/visit-logs');
        setVisits(Array.isArray(data) ? data : []);
      } else if (t === 'upsell') {
        const data = await fetchWithAuth<UpsellAlert[]>('/api/sales-reps/upsell-alerts');
        setAlerts(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      setError(String((err as Error).message || 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [tab]);

  async function loadOrderHistory(customer: Customer) {
    setSelectedCustomer(customer);
    setTab('history');
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Order[]>(`/api/sales-reps/order-history/${customer.id}`);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Failed to load orders'));
    } finally {
      setLoading(false);
    }
  }

  async function submitVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!visitCustomerId) return setError('Customer ID is required');
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await sendWithAuth('/api/sales-reps/visit-logs', 'POST', {
        customer_id: visitCustomerId,
        customer_name: visitCustomerName,
        notes: visitNotes,
        outcome: visitOutcome,
      });
      setSuccess('Visit logged successfully');
      setVisitNotes('');
      load('visits');
    } catch (err) {
      setError(String((err as Error).message || 'Failed to log visit'));
    } finally {
      setLoading(false);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'customers', label: 'My Customers' },
    { key: 'visits', label: 'Visit Log' },
    { key: 'upsell', label: 'Upsell Alerts' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Sales Rep Hub</h1>
        <p className="text-sm text-muted-foreground">Customer visits, order history, and AI-driven upsell alerts.</p>
      </div>

      {error && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
      {success && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{success}</div>}

      <div className="flex gap-2 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
        {tab === 'history' && selectedCustomer && (
          <button
            onClick={() => setTab('customers')}
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to Customers
          </button>
        )}
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading...</div>}

      {/* MY CUSTOMERS */}
      {tab === 'customers' && !loading && (
        <Card>
          <CardHeader>
            <CardTitle>My Customers</CardTitle>
            <CardDescription>{customers.length} assigned customer{customers.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.length ? customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.company_name || '—'}</TableCell>
                    <TableCell>{c.email || '—'}</TableCell>
                    <TableCell>{c.phone_number || '—'}</TableCell>
                    <TableCell>{c.payment_terms || '—'}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => loadOrderHistory(c)}>Order History</Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={5} className="text-muted-foreground">No customers assigned.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* VISIT LOG */}
      {tab === 'visits' && !loading && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Log a Visit</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submitVisit} className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  Customer ID
                  <Input value={visitCustomerId} onChange={(e) => setVisitCustomerId(e.target.value)} placeholder="Customer ID" />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Customer Name
                  <Input value={visitCustomerName} onChange={(e) => setVisitCustomerName(e.target.value)} placeholder="Optional" />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Outcome
                  <select
                    value={visitOutcome}
                    onChange={(e) => setVisitOutcome(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2">
                  Notes
                  <textarea
                    value={visitNotes}
                    onChange={(e) => setVisitNotes(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                    placeholder="Visit notes..."
                  />
                </label>
                <Button type="submit" className="sm:col-span-2 w-fit">Log Visit</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Visits</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Rep</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visits.length ? visits.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>{v.customer_name || '—'}</TableCell>
                      <TableCell>{v.sales_rep_name || '—'}</TableCell>
                      <TableCell>{v.outcome ? v.outcome.replace(/_/g, ' ') : '—'}</TableCell>
                      <TableCell className="max-w-xs truncate">{v.notes || '—'}</TableCell>
                      <TableCell>{v.visited_at ? new Date(v.visited_at).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">No visits logged yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* UPSELL ALERTS */}
      {tab === 'upsell' && !loading && (
        <Card>
          <CardHeader>
            <CardTitle>Upsell Alerts</CardTitle>
            <CardDescription>Customers who haven't ordered forecasted high-demand items in the last 60 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Missing Items</TableHead>
                  <TableHead>Alert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.length ? alerts.map((a) => (
                  <TableRow key={a.customer_id}>
                    <TableCell className="font-medium">{a.customer_name}</TableCell>
                    <TableCell>{a.missing_items.join(', ')}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.alert}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={3} className="text-muted-foreground">No upsell alerts right now.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ORDER HISTORY */}
      {tab === 'history' && !loading && selectedCustomer && (
        <Card>
          <CardHeader>
            <CardTitle>Order History — {selectedCustomer.company_name}</CardTitle>
            <CardDescription>{orders.length} order{orders.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length ? orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.created_at ? new Date(o.created_at).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="capitalize">{o.status || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {Array.isArray(o.items) ? o.items.map((i) => `${i.description || ''} x${i.quantity || 1}`).join(', ') : '—'}
                    </TableCell>
                    <TableCell>{o.total != null ? money(parseFloat(String(o.total))) : '—'}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={4} className="text-muted-foreground">No orders found.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
