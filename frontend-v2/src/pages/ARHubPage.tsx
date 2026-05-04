import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type AgingRow = {
  customer_name: string;
  customer_email: string | null;
  buckets: Record<string, number>;
  total_open: number;
  invoice_count: number;
  oldest_due_date: string;
};

type CollectionRow = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_email?: string;
  total: number;
  status?: string;
  due_date?: string;
  days_overdue: number;
  collections_note?: string;
  collections_status?: string;
};

const BUCKET_LABELS = ['Current', '1-30', '31-60', '61-90', '90+'];
const COLLECTION_STATUSES = ['open', 'contacted', 'promise_to_pay', 'escalated', 'resolved'];

function money(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function statusBadgeClass(s?: string) {
  switch (s) {
    case 'resolved': return 'bg-green-100 text-green-800';
    case 'escalated': return 'bg-red-100 text-red-800';
    case 'promise_to_pay': return 'bg-yellow-100 text-yellow-800';
    case 'contacted': return 'bg-blue-100 text-blue-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

export function ARHubPage() {
  const [tab, setTab] = useState<'aging' | 'collections'>('aging');
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [noteState, setNoteState] = useState<Record<string, { note: string; status: string }>>({});

  async function loadAging() {
    setLoading(true); setError('');
    try {
      const data = await fetchWithAuth<{ aging: AgingRow[] }>('/api/ar/aging');
      setAging(Array.isArray(data?.aging) ? data.aging : []);
    } catch (err) { setError(String((err as Error).message)); }
    finally { setLoading(false); }
  }

  async function loadCollections() {
    setLoading(true); setError('');
    try {
      const data = await fetchWithAuth<CollectionRow[]>('/api/ar/collections');
      setCollections(Array.isArray(data) ? data : []);
      const initial: Record<string, { note: string; status: string }> = {};
      (Array.isArray(data) ? data : []).forEach((r) => {
        initial[r.id] = { note: r.collections_note || '', status: r.collections_status || 'open' };
      });
      setNoteState(initial);
    } catch (err) { setError(String((err as Error).message)); }
    finally { setLoading(false); }
  }

  useEffect(() => { tab === 'aging' ? loadAging() : loadCollections(); }, [tab]);

  async function sendReminder(customer_email: string | null, customer_name: string) {
    const id = customer_email || customer_name;
    if (!id) return setError('No email or name to look up for this customer');
    setSuccess(''); setError('');
    try {
      const result = await fetchWithAuth<{ sent: number; total_owed: number }>(
        `/api/ar/remind/${encodeURIComponent(id)}`,
        { method: 'POST' }
      );
      setSuccess(`Sent ${result.sent} reminder email${result.sent !== 1 ? 's' : ''} — ${money(result.total_owed)} owed`);
    } catch (err) { setError(String((err as Error).message)); }
  }

  async function saveNote(invoiceId: string) {
    const state = noteState[invoiceId];
    if (!state) return;
    setError(''); setSuccess('');
    try {
      await fetchWithAuth(`/api/ar/collections/${invoiceId}/note`, {
        method: 'PATCH',
        body: JSON.stringify({ note: state.note, collections_status: state.status }),
      });
      setSuccess('Note saved');
    } catch (err) { setError(String((err as Error).message)); }
  }

  const totalOpen = aging.reduce((s, r) => s + r.total_open, 0);
  const total90Plus = aging.reduce((s, r) => s + (r.buckets['90+'] || 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">AR / Finance Hub</h1>
        <p className="text-sm text-muted-foreground">Invoice aging, payment reminders, and collections workflow.</p>
      </div>

      {error && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
      {success && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{success}</div>}

      <div className="flex gap-2 border-b border-border pb-2">
        {(['aging', 'collections'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'aging' ? 'Aging Dashboard' : 'Collections'}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading...</div>}

      {/* AGING */}
      {tab === 'aging' && !loading && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard title="Total Open AR" value={money(totalOpen)} />
            <SummaryCard title="Accounts" value={aging.length.toLocaleString()} />
            <SummaryCard title="90+ Days" value={money(total90Plus)} highlight={total90Plus > 0} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Aging by Customer</CardTitle>
              <CardDescription>All open invoices grouped into aging buckets. Click Send Reminder to email the customer.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      {BUCKET_LABELS.map((b) => <TableHead key={b}>{b}</TableHead>)}
                      <TableHead>Total Open</TableHead>
                      <TableHead>Invoices</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aging.length ? aging.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{row.customer_name}</TableCell>
                        {BUCKET_LABELS.map((b) => (
                          <TableCell key={b} className={row.buckets[b] > 0 ? (b === '90+' ? 'text-red-600 font-semibold' : b === '61-90' ? 'text-orange-500' : '') : 'text-muted-foreground'}>
                            {row.buckets[b] > 0 ? money(row.buckets[b]) : '—'}
                          </TableCell>
                        ))}
                        <TableCell className="font-semibold">{money(row.total_open)}</TableCell>
                        <TableCell>{row.invoice_count}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => sendReminder(row.customer_email, row.customer_name)}>
                            Send Reminder
                          </Button>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={9} className="text-muted-foreground">No open AR. All caught up!</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* COLLECTIONS */}
      {tab === 'collections' && !loading && (
        <Card>
          <CardHeader>
            <CardTitle>Collections Workflow</CardTitle>
            <CardDescription>Invoices overdue by more than 30 days. Update status and notes as you work each account.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {collections.length ? collections.map((row) => (
                <div key={row.id} className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{row.customer_name || 'Unknown'}</p>
                      <p className="text-sm text-muted-foreground">{row.invoice_number} — {money(row.total)} — <span className="text-red-600">{row.days_overdue}d overdue</span></p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(noteState[row.id]?.status)}`}>
                      {(noteState[row.id]?.status || 'open').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      Status
                      <select
                        value={noteState[row.id]?.status || 'open'}
                        onChange={(e) => setNoteState((prev) => ({ ...prev, [row.id]: { ...prev[row.id], status: e.target.value } }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      >
                        {COLLECTION_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      Collections Note
                      <input
                        type="text"
                        value={noteState[row.id]?.note || ''}
                        onChange={(e) => setNoteState((prev) => ({ ...prev, [row.id]: { ...prev[row.id], note: e.target.value } }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                        placeholder="Notes..."
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveNote(row.id)}>Save Note</Button>
                    <Button size="sm" variant="outline" onClick={() => sendReminder(row.customer_email || null, row.customer_name || '')}>
                      Send Reminder
                    </Button>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No overdue accounts in collections.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ title, value, highlight }: { title: string; value: string; highlight?: boolean }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1 pb-2">
        <CardDescription>{title}</CardDescription>
        <p className={`text-2xl font-bold ${highlight ? 'text-red-600' : ''}`}>{value}</p>
      </CardHeader>
    </Card>
  );
}
