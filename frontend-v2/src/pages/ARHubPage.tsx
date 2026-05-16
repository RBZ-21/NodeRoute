import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useARAging, useARCollections, useSaveCollectionNote, useSendReminder } from '../hooks/useAR';
import { useLatePaymentRisk } from '../hooks/useAI';

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

const RISK_COLORS: Record<string, string> = {
  HIGH: 'text-red-700 bg-red-50 border-red-200',
  MEDIUM: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  LOW: 'text-green-700 bg-green-50 border-green-200',
};

export function ARHubPage() {
  const [tab, setTab] = useState<'aging' | 'collections' | 'payment-risk'>('aging');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [noteState, setNoteState] = useState<Record<string, { note: string; status: string }>>({});

  const { data: aging = [], isLoading: loadingAging } = useARAging();
  const { data: collections = [], isLoading: loadingCollections } = useARCollections();
  const { data: riskData, isFetching: loadingRisk, refetch: refetchRisk } = useLatePaymentRisk(tab === 'payment-risk');
  const sendReminder = useSendReminder();
  const saveNote = useSaveCollectionNote();

  // Seed noteState from collections data when it loads
  const collectionNoteState = (id: string, field: 'note' | 'status', fallback: string) =>
    noteState[id]?.[field] ?? fallback;

  async function handleReminder(email: string | null, name: string) {
    const id = email || name;
    if (!id) { setError('No email or name to look up for this customer'); return; }
    setError(''); setNotice('');
    try {
      const result = await sendReminder.mutateAsync(id);
      setNotice(`Sent ${result.sent} reminder email${result.sent !== 1 ? 's' : ''} — ${money(result.total_owed)} owed`);
    } catch (err) { setError(String((err as Error)?.message || 'Failed to send reminder')); }
  }

  async function handleSaveNote(invoiceId: string, row: { collections_note?: string; collections_status?: string }) {
    const note = collectionNoteState(invoiceId, 'note', row.collections_note || '');
    const status = collectionNoteState(invoiceId, 'status', row.collections_status || 'open');
    setError(''); setNotice('');
    try {
      await saveNote.mutateAsync({ invoiceId, note, status });
      setNotice('Note saved');
    } catch (err) { setError(String((err as Error)?.message || 'Failed to save note')); }
  }

  const totalOpen = aging.reduce((s, r) => s + r.total_open, 0);
  const total90Plus = aging.reduce((s, r) => s + (r.buckets['90+'] || 0), 0);
  const loading = loadingAging || loadingCollections;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">AR / Finance Hub</h1>
        <p className="text-sm text-muted-foreground">Invoice aging, payment reminders, and collections workflow.</p>
      </div>

      {error && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{notice}</div>}

      <div className="flex gap-2 border-b border-border pb-2">
        {([['aging', 'Aging Dashboard'], ['collections', 'Collections'], ['payment-risk', '✦ Late Payment Risk']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading...</div>}

      {tab === 'aging' && (
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
                      <TableHead>Total Open</TableHead><TableHead>Invoices</TableHead><TableHead></TableHead>
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
                          <Button size="sm" variant="outline" disabled={sendReminder.isPending} onClick={() => handleReminder(row.customer_email, row.customer_name)}>Send Reminder</Button>
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

      {tab === 'payment-risk' && (
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Late Payment Risk</CardTitle>
              <CardDescription>
                {riskData?.summary || 'AI-scored risk assessment for open accounts based on invoice age, amount, and overdue history.'}
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => void refetchRisk()} disabled={loadingRisk}>
              {loadingRisk ? 'Analyzing…' : riskData ? 'Refresh' : 'Run Analysis'}
            </Button>
          </CardHeader>
          {loadingRisk && (
            <CardContent>
              <div className="text-sm text-muted-foreground">Analyzing payment patterns…</div>
            </CardContent>
          )}
          {riskData && (
            <CardContent>
              {riskData.risks.length === 0 ? (
                <p className="text-sm text-emerald-600">No late payment risks detected. All accounts are current.</p>
              ) : (
                <div className="space-y-2">
                  {riskData.risks.map((r, i) => (
                    <div key={i} className={`rounded-lg border px-4 py-3 ${RISK_COLORS[r.risk_level] ?? 'bg-muted border-border'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{r.customer_name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium border ${RISK_COLORS[r.risk_level]}`}>
                            {r.risk_level} · {r.risk_score}/100
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-sm">{r.flag_reason}</p>
                      <p className="mt-1 text-xs font-medium">→ {r.recommended_action}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {tab === 'collections' && (
        <Card>
          <CardHeader>
            <CardTitle>Collections Workflow</CardTitle>
            <CardDescription>Invoices overdue by more than 30 days. Update status and notes as you work each account.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {collections.length ? collections.map((row) => {
                const currentStatus = collectionNoteState(row.id, 'status', row.collections_status || 'open');
                const currentNote = collectionNoteState(row.id, 'note', row.collections_note || '');
                return (
                  <div key={row.id} className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{row.customer_name || 'Unknown'}</p>
                        <p className="text-sm text-muted-foreground">{row.invoice_number} — {money(row.total)} — <span className="text-red-600">{row.days_overdue}d overdue</span></p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(currentStatus)}`}>
                        {currentStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1 text-sm">Status
                        <select value={currentStatus} onChange={(e) => setNoteState((p) => ({ ...p, [row.id]: { ...p[row.id], status: e.target.value } }))} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                          {COLLECTION_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1 text-sm">Collections Note
                        <input type="text" value={currentNote} onChange={(e) => setNoteState((p) => ({ ...p, [row.id]: { ...p[row.id], note: e.target.value } }))} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm" placeholder="Notes..." />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={saveNote.isPending} onClick={() => handleSaveNote(row.id, row)}>Save Note</Button>
                      <Button size="sm" variant="outline" disabled={sendReminder.isPending} onClick={() => handleReminder(row.customer_email || null, row.customer_name || '')}>Send Reminder</Button>
                    </div>
                  </div>
                );
              }) : (
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
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className={`text-2xl font-bold ${highlight ? 'text-red-600' : ''}`}>{value}</p>
      </CardHeader>
    </Card>
  );
}
