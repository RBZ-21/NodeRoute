import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type Invoice, type InvoiceLotEntry, useDeleteInvoice, useInvoices, useUpdateInvoice } from '../hooks/useInvoices';

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'other';

const statusColors = {
  draft: 'gray',
  sent: 'blue',
  paid: 'green',
  overdue: 'red',
  cancelled: 'gray',
} as const;

function normalizeStatus(value: string | undefined): InvoiceStatus {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'draft') return 'draft';
  if (s === 'sent') return 'sent';
  if (s === 'paid') return 'paid';
  if (s === 'overdue') return 'overdue';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return 'other';
}

function invoiceId(inv: Invoice): string {
  return String(inv.invoiceNumber || inv.invoice_number || inv.id || '-');
}
function customerName(inv: Invoice): string {
  return String(inv.customerName || inv.customer_name || inv.customerId || inv.customer_id || '-');
}
function formatAmount(val: number | string | undefined): string {
  const n = Number(val);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
}
function formatDate(val: string | undefined): string {
  if (!val) return '-';
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '-';
}
function lotSummary(lots: InvoiceLotEntry[] | undefined): string {
  if (!lots || lots.length === 0) return '-';
  return lots.map((l) => l.lot_number).filter(Boolean).join(', ');
}

export function InvoicesPage() {
  const { data: invoices = [], isLoading, isError, error, refetch } = useInvoices();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();

  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Invoice>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && normalizeStatus(inv.status) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const lotMatch = (inv.lot_numbers || []).some((l) => l.lot_number?.toLowerCase().includes(q));
        const matches =
          invoiceId(inv).toLowerCase().includes(q) ||
          customerName(inv).toLowerCase().includes(q) ||
          String(inv.orderId || inv.order_id || '').toLowerCase().includes(q) ||
          lotMatch;
        if (!matches) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, search]);

  const summary = useMemo(() => ({
    total: invoices.length,
    paid: invoices.filter((i) => normalizeStatus(i.status) === 'paid').length,
    overdue: invoices.filter((i) => normalizeStatus(i.status) === 'overdue').length,
    outstanding: invoices.filter((i) => ['sent', 'draft'].includes(normalizeStatus(i.status))).length,
  }), [invoices]);

  function openInvoice(inv: Invoice) {
    setSelected(inv);
    setDraft({ ...inv });
    setEditing(false);
  }

  function handleDelete() {
    const id = selected?.id;
    if (!id) return;
    deleteInvoice.mutate(id, {
      onSuccess: () => {
        setNotice(`Invoice ${invoiceId(selected!)} deleted.`);
        setSelected(null);
        setConfirmDelete(false);
      },
    });
  }

  function saveInvoice() {
    const id = selected?.id;
    if (!id) return;
    updateInvoice.mutate(
      { id, patch: draft as Record<string, unknown> },
      {
        onSuccess: () => {
          setSelected({ ...selected!, ...draft });
          setEditing(false);
          setNotice(`Invoice ${invoiceId(selected!)} saved.`);
        },
      }
    );
  }

  return (
    <div className="space-y-5">
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading invoices...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load invoices')}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total" value={summary.total.toLocaleString()} />
        <SummaryCard label="Paid" value={summary.paid.toLocaleString()} />
        <SummaryCard label="Overdue" value={summary.overdue.toLocaleString()} />
        <SummaryCard label="Outstanding" value={summary.outstanding.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Invoices</CardTitle>
            <CardDescription>Billing records from `/api/invoices`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | InvoiceStatus)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input placeholder="Invoice #, customer, lot #..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-52" />
            </label>
            <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          {/* Horizontally scrollable wrapper for mobile */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden sm:table-cell">Order #</TableHead>
                  <TableHead className="hidden sm:table-cell">Lot #(s)</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Issued</TableHead>
                  <TableHead className="hidden md:table-cell">Due</TableHead>
                  <TableHead className="hidden md:table-cell">Paid</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? filtered.map((inv) => {
                  const status = normalizeStatus(inv.status);
                  return (
                    <TableRow key={invoiceId(inv)}>
                      <TableCell className="font-medium whitespace-nowrap">{invoiceId(inv)}</TableCell>
                      <TableCell className="max-w-[140px] truncate">{customerName(inv)}</TableCell>
                      <TableCell className="hidden sm:table-cell">{inv.orderId || inv.order_id || '-'}</TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs">{lotSummary(inv.lot_numbers)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatAmount(inv.amount)}</TableCell>
                      <TableCell><StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                      <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(inv.issuedDate || inv.issued_date)}</TableCell>
                      <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(inv.dueDate || inv.due_date)}</TableCell>
                      <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(inv.paidDate || inv.paid_date)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" className="whitespace-nowrap" onClick={() => openInvoice(inv)}>View / Edit</Button>
                      </TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow><TableCell colSpan={10} className="text-muted-foreground">No invoices found.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">{invoiceId(selected)}</h2>
                <p className="text-sm text-muted-foreground">{customerName(selected)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!editing && !confirmDelete && (
                  <>
                    <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>Delete</Button>
                  </>
                )}
                {editing && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); }}>Cancel</Button>
                    <Button size="sm" disabled={updateInvoice.isPending} onClick={saveInvoice}>{updateInvoice.isPending ? 'Saving...' : 'Save'}</Button>
                  </>
                )}
                {confirmDelete && (
                  <>
                    <span className="self-center text-sm text-destructive">Delete?</span>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>No</Button>
                    <Button size="sm" disabled={deleteInvoice.isPending} onClick={handleDelete}>{deleteInvoice.isPending ? 'Deleting...' : 'Yes'}</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => { setSelected(null); setConfirmDelete(false); }}>✕</Button>
              </div>
            </div>
            <div className="flex-1 space-y-4 p-6">
              <InvoiceField label="Invoice #" value={draft.invoiceNumber || draft.invoice_number} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, invoiceNumber: v }))} />
              <InvoiceField label="Customer" value={draft.customerName || draft.customer_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, customerName: v }))} />
              <InvoiceField label="Amount" value={String(draft.amount ?? '')} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
              <div className="flex items-start gap-3">
                <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
                {editing ? (
                  <select value={draft.status || ''} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                ) : (
                  <span className="text-sm capitalize">{selected.status || '-'}</span>
                )}
              </div>
              <InvoiceField label="Due Date" value={draft.dueDate || draft.due_date} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, dueDate: v }))} />
              <InvoiceField label="Notes" value={draft.notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} multiline />

              {/* Lot Numbers Section */}
              {(selected.lot_numbers && selected.lot_numbers.length > 0) && (
                <div className="space-y-2">
                  <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Lot Numbers</span>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Item #</th>
                          <th className="px-3 py-2 text-left font-semibold">Description</th>
                          <th className="px-3 py-2 text-left font-semibold">Lot #</th>
                          <th className="px-3 py-2 text-right font-semibold">Qty</th>
                          <th className="px-3 py-2 text-right font-semibold">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lot_numbers.map((lot, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-2 font-mono">{lot.item_number || '-'}</td>
                            <td className="px-3 py-2">{lot.description || '-'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-amber-700">{lot.lot_number}</td>
                            <td className="px-3 py-2 text-right">{lot.qty ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{lot.weight != null ? `${lot.weight} lbs` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoiceField({ label, value, editing, onChange, multiline }: { label: string; value?: string | null; editing: boolean; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">{label}</span>
      {editing ? (
        multiline ? (
          <textarea className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
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
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>
  );
}
