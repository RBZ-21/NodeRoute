import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  useLogVisit,
  useOrderHistory,
  useSalesRepCustomers,
  useUpsellAlerts,
  useVisitLogs,
  type Customer,
} from '../hooks/useSalesRep';

type Tab = 'customers' | 'visits' | 'upsell' | 'history';

const OUTCOMES = ['order_placed', 'follow_up', 'no_answer', 'demo', 'other'];

function money(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '—';
}

export function SalesRepPage() {
  const [tab, setTab] = useState<Tab>('customers');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [notice, setNotice] = useState('');

  const [visitCustomerId, setVisitCustomerId] = useState('');
  const [visitCustomerName, setVisitCustomerName] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [visitOutcome, setVisitOutcome] = useState(OUTCOMES[0]);

  const {
    data: customers = [],
    isLoading: loadingCustomers,
    isError: customersError,
  } = useSalesRepCustomers();
  const {
    data: visits = [],
    isLoading: loadingVisits,
    isError: visitsError,
  } = useVisitLogs();
  const {
    data: alerts = [],
    isLoading: loadingAlerts,
    isError: alertsError,
  } = useUpsellAlerts();
  const {
    data: orders = [],
    isLoading: loadingOrders,
    isError: ordersError,
  } = useOrderHistory(selectedCustomer?.id ?? null);
  const logVisit = useLogVisit();

  const loading = loadingCustomers || loadingVisits || loadingAlerts || loadingOrders || logVisit.isPending;
  const loadError = customersError || visitsError || alertsError || ordersError;

  async function submitVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!visitCustomerId) return;
    try {
      await logVisit.mutateAsync({
        customer_id: visitCustomerId,
        customer_name: visitCustomerName,
        notes: visitNotes,
        outcome: visitOutcome,
      });
      setNotice('Visit logged successfully');
      setVisitNotes('');
    } catch (err) {
      setNotice(String((err as Error)?.message || 'Failed to log visit'));
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

      {notice && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{notice}</div>}
      {loadError && (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          Sales Rep data could not be loaded. Please try again.
        </div>
      )}
      {loading && <div className="text-sm text-muted-foreground">Loading...</div>}

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
          <button onClick={() => setTab('customers')} className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            ← Back to Customers
          </button>
        )}
      </div>

      {tab === 'customers' && (
        <Card>
          <CardHeader>
            <CardTitle>My Customers</CardTitle>
            <CardDescription>{customers.length} assigned customer{customers.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead><TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead><TableHead>Terms</TableHead><TableHead></TableHead>
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
                      <Button size="sm" variant="outline" onClick={() => { setSelectedCustomer(c); setTab('history'); }}>Order History</Button>
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

      {tab === 'visits' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Log a Visit</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submitVisit} className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">Customer ID
                  <Input value={visitCustomerId} onChange={(e) => setVisitCustomerId(e.target.value)} placeholder="Customer ID" />
                </label>
                <label className="space-y-1 text-sm font-medium">Customer Name
                  <Input value={visitCustomerName} onChange={(e) => setVisitCustomerName(e.target.value)} placeholder="Optional" />
                </label>
                <label className="space-y-1 text-sm font-medium">Outcome
                  <select value={visitOutcome} onChange={(e) => setVisitOutcome(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                    {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2">Notes
                  <textarea value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} rows={3} className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm" placeholder="Visit notes..." />
                </label>
                <Button type="submit" disabled={logVisit.isPending} className="sm:col-span-2 w-fit">
                  {logVisit.isPending ? 'Logging...' : 'Log Visit'}
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent Visits</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead><TableHead>Rep</TableHead>
                    <TableHead>Outcome</TableHead><TableHead>Notes</TableHead><TableHead>Date</TableHead>
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

      {tab === 'upsell' && (
        <Card>
          <CardHeader>
            <CardTitle>Upsell Alerts</CardTitle>
            <CardDescription>Customers who haven't ordered forecasted high-demand items in the last 60 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Customer</TableHead><TableHead>Missing Items</TableHead><TableHead>Alert</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {alerts.length ? alerts.map((a) => (
                  <TableRow key={a.customer_id}>
                    <TableCell className="font-medium">{a.customer_name || '—'}</TableCell>
                    <TableCell>{a.missing_items.length ? a.missing_items.join(', ') : '—'}</TableCell>
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

      {tab === 'history' && selectedCustomer && (
        <Card>
          <CardHeader>
            <CardTitle>Order History — {selectedCustomer.company_name}</CardTitle>
            <CardDescription>{orders.length} order{orders.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {orders.length ? orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.created_at ? new Date(o.created_at).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="capitalize">{o.status || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {Array.isArray(o.items) && o.items.length
                        ? o.items.map((i) => `${i.description || ''} x${i.quantity || 1}`).join(', ')
                        : '—'}
                    </TableCell>
                    <TableCell>{money(o.total)}</TableCell>
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
