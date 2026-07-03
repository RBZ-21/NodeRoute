import type { Dispatch, SetStateAction } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { DetailField } from '../components/ui/detail-field';
import { Input } from '../components/ui/input';
import { SelectInput } from '../components/ui/select-input';
import { SlideOver } from '../components/ui/overlay-panel';
import { StatusBadge } from '../components/ui/status-badge';
import type { Invoice, useAddInvoiceAddon, useCreateInvoiceReturn, useDeleteInvoice, useResendInvoiceEmail, useUpdateInvoice } from '../hooks/useInvoices';
import type { InvoiceFollowUpResult, LatePaymentRisk } from '../hooks/useAI';

type AddonDraft = { product_id: string; qty: string; uom: string; price: string; reason: string };
type ReturnDraft = { amount: string; reason: string };

const riskColors = {
  high: 'red',
  medium: 'yellow',
  low: 'green',
} as const;

export function InvoiceDetailDrawer({
  selected,
  draft,
  setDraft,
  editing,
  setEditing,
  confirmDelete,
  setConfirmDelete,
  selectedRisk,
  followUpDraft,
  followUpInvoiceId,
  followUpError,
  followUpPending,
  addonDraft,
  setAddonDraft,
  returnDraft,
  setReturnDraft,
  updateInvoice,
  deleteInvoice,
  resendInvoiceEmail,
  addInvoiceAddon,
  createInvoiceReturn,
  markingDeliveredInvoiceId,
  markingPaidInvoiceId,
  invoiceId,
  customerName,
  formatAmount,
  formatDate,
  totalLotQuantity,
  totalLotWeight,
  invoicePrintBlocked,
  shouldSuggestFollowUp,
  daysPastDue,
  toneLabel,
  onClose,
  onMarkDelivered,
  onMarkPaid,
  onPrint,
  onResend,
  onGenerateFollowUp,
  onSave,
  onDelete,
  onSubmitAddon,
  onSubmitReturnCredit,
  onCopyFollowUp,
}: {
  selected: Invoice;
  draft: Partial<Invoice>;
  setDraft: Dispatch<SetStateAction<Partial<Invoice>>>;
  editing: boolean;
  setEditing: Dispatch<SetStateAction<boolean>>;
  confirmDelete: boolean;
  setConfirmDelete: Dispatch<SetStateAction<boolean>>;
  selectedRisk: LatePaymentRisk | undefined;
  followUpDraft: InvoiceFollowUpResult | null;
  followUpInvoiceId: string | null;
  followUpError: string;
  followUpPending: boolean;
  addonDraft: AddonDraft;
  setAddonDraft: Dispatch<SetStateAction<AddonDraft>>;
  returnDraft: ReturnDraft;
  setReturnDraft: Dispatch<SetStateAction<ReturnDraft>>;
  updateInvoice: ReturnType<typeof useUpdateInvoice>;
  deleteInvoice: ReturnType<typeof useDeleteInvoice>;
  resendInvoiceEmail: ReturnType<typeof useResendInvoiceEmail>;
  addInvoiceAddon: ReturnType<typeof useAddInvoiceAddon>;
  createInvoiceReturn: ReturnType<typeof useCreateInvoiceReturn>;
  markingDeliveredInvoiceId: string | null;
  markingPaidInvoiceId: string | null;
  invoiceId: (inv: Invoice) => string;
  customerName: (inv: Invoice) => string;
  formatAmount: (val: number | string | undefined) => string;
  formatDate: (val: string | undefined) => string;
  totalLotQuantity: (lots: Invoice['lot_numbers']) => number;
  totalLotWeight: (lots: Invoice['lot_numbers']) => number;
  invoicePrintBlocked: (invoice: Invoice) => boolean;
  shouldSuggestFollowUp: (invoice: Invoice) => boolean;
  daysPastDue: (invoice: Invoice) => number;
  toneLabel: (tone: InvoiceFollowUpResult['tone'] | undefined) => string;
  onClose: () => void;
  onMarkDelivered: (inv: Invoice) => void;
  onMarkPaid: (inv: Invoice) => void;
  onPrint: (inv: Invoice) => void;
  onResend: (inv: Invoice) => void;
  onGenerateFollowUp: (inv: Invoice) => void;
  onSave: () => void;
  onDelete: () => void;
  onSubmitAddon: () => void;
  onSubmitReturnCredit: () => void;
  onCopyFollowUp: () => void;
}) {
  const selStatus = String(selected.status || 'pending').toLowerCase();
  const selDelivered = selStatus === 'delivered';
  const selPaid = selStatus === 'paid';

  return (
    <SlideOver
      open
      title={invoiceId(selected)}
      description={customerName(selected)}
      onClose={onClose}
      widthClassName="max-w-2xl"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!confirmDelete && (
            <Button
              size="sm"
              variant="outline"
              className={selDelivered ? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100' : ''}
              disabled={selDelivered || selPaid || (updateInvoice.isPending && markingDeliveredInvoiceId === String(selected.id || ''))}
              onClick={() => onMarkDelivered(selected)}
            >
              {updateInvoice.isPending && markingDeliveredInvoiceId === String(selected.id || '') ? 'Saving...' : 'Delivered'}
            </Button>
          )}
          {!confirmDelete && (
            <Button
              size="sm"
              variant={selPaid ? 'outline' : 'default'}
              disabled={selPaid || (updateInvoice.isPending && markingPaidInvoiceId === String(selected.id || ''))}
              onClick={() => onMarkPaid(selected)}
            >
              {updateInvoice.isPending && markingPaidInvoiceId === String(selected.id || '') ? 'Saving...' : 'PAID'}
            </Button>
          )}
          {!confirmDelete && (
            <Button
              size="sm"
              variant="outline"
              disabled={invoicePrintBlocked(selected)}
              onClick={() => onPrint(selected)}
            >
              Print / Save PDF
            </Button>
          )}
          {!confirmDelete && (
            <Button
              size="sm"
              variant="outline"
              disabled={resendInvoiceEmail.isPending}
              onClick={() => onResend(selected)}
            >
              {resendInvoiceEmail.isPending ? 'Sending...' : 'Resend Email'}
            </Button>
          )}
          {!editing && !confirmDelete && shouldSuggestFollowUp(selected) && (
            <Button
              size="sm"
              variant="outline"
              disabled={followUpPending && followUpInvoiceId === String(selected.id || '')}
              onClick={() => onGenerateFollowUp(selected)}
            >
              {followUpPending && followUpInvoiceId === String(selected.id || '') ? 'Drafting...' : 'Refresh AI Draft'}
            </Button>
          )}
          {!editing && !confirmDelete && (
            <>
              <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>Delete</Button>
            </>
          )}
          {editing && (
            <>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft({ ...selected }); }}>Cancel</Button>
              <Button size="sm" disabled={updateInvoice.isPending} onClick={onSave}>{updateInvoice.isPending ? 'Saving...' : 'Save'}</Button>
            </>
          )}
          {confirmDelete && (
            <>
              <span className="self-center text-sm text-destructive">Delete?</span>
              <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>No</Button>
              <Button size="sm" disabled={deleteInvoice.isPending} onClick={onDelete}>{deleteInvoice.isPending ? 'Deleting...' : 'Yes'}</Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice Summary</div>
            <div className="mt-2 space-y-1 text-sm">
              <div>Status: <strong className="capitalize">{String(selected.status || 'pending').replace('_', ' ')}</strong></div>
              <div>Amount: <strong>{formatAmount(draft.amount)}</strong></div>
              <div>Issued: <strong>{formatDate(selected.created_at || selected.issuedDate || selected.issued_date)}</strong></div>
              <div>Due: <strong>{formatDate(draft.dueDate || draft.due_date)}</strong></div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fulfillment Summary</div>
            <div className="mt-2 space-y-1 text-sm">
              <div>Lots tracked: <strong>{(selected.lot_numbers || []).length.toLocaleString()}</strong></div>
              <div>Total lot qty: <strong>{totalLotQuantity(selected.lot_numbers).toLocaleString()}</strong></div>
              <div>Total weight: <strong>{totalLotWeight(selected.lot_numbers).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} lbs</strong></div>
              <div>Printable record: <strong>{invoicePrintBlocked(selected) ? 'Waiting on final weights' : 'Ready'}</strong></div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Collections Risk</div>
            <div className="mt-2 space-y-2 text-sm">
              {selectedRisk ? (
                <>
                  <StatusBadge status={selectedRisk.risk_level.toLowerCase()} colorMap={riskColors} fallbackLabel={selectedRisk.risk_level} />
                  <div>Risk score: <strong>{selectedRisk.risk_score}</strong></div>
                  <div>{selectedRisk.flag_reason}</div>
                  <div className="text-muted-foreground">{selectedRisk.recommended_action}</div>
                </>
              ) : (
                <div className="text-muted-foreground">No AI risk flag for this customer right now.</div>
              )}
            </div>
          </div>
        </div>

        {invoicePrintBlocked(selected) ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Print is locked for this invoice because weight-based items are still marked as estimated. Finish final weight entry before creating a customer-facing PDF.
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add-Ons and Credits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_100px_100px_100px]">
              <Input
                placeholder="Product ID"
                value={addonDraft.product_id}
                onChange={(event) => setAddonDraft((current) => ({ ...current, product_id: event.target.value }))}
              />
              <Input
                placeholder="Qty"
                type="number"
                min="0"
                step="0.01"
                value={addonDraft.qty}
                onChange={(event) => setAddonDraft((current) => ({ ...current, qty: event.target.value }))}
              />
              <Input
                placeholder="UOM"
                value={addonDraft.uom}
                onChange={(event) => setAddonDraft((current) => ({ ...current, uom: event.target.value }))}
              />
              <Input
                placeholder="Price"
                type="number"
                min="0"
                step="0.01"
                value={addonDraft.price}
                onChange={(event) => setAddonDraft((current) => ({ ...current, price: event.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-64 flex-1"
                placeholder="Add-on reason"
                value={addonDraft.reason}
                onChange={(event) => setAddonDraft((current) => ({ ...current, reason: event.target.value }))}
              />
              <Button size="sm" onClick={onSubmitAddon} disabled={addInvoiceAddon.isPending}>
                {addInvoiceAddon.isPending ? 'Saving...' : 'Add to Invoice'}
              </Button>
            </div>
            <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-[120px_minmax(0,1fr)_auto]">
              <Input
                placeholder="Amount"
                type="number"
                min="0"
                step="0.01"
                value={returnDraft.amount}
                onChange={(event) => setReturnDraft((current) => ({ ...current, amount: event.target.value }))}
              />
              <Input
                placeholder="Return reason"
                value={returnDraft.reason}
                onChange={(event) => setReturnDraft((current) => ({ ...current, reason: event.target.value }))}
              />
              <Button size="sm" variant="outline" onClick={onSubmitReturnCredit} disabled={createInvoiceReturn.isPending}>
                {createInvoiceReturn.isPending ? 'Issuing...' : 'Issue Credit'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {shouldSuggestFollowUp(selected) ? (
          <Card className="border-blue-200 bg-blue-50/60">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-base">AI Follow-Up Draft</CardTitle>
                <CardDescription>
                  {followUpDraft
                    ? `${toneLabel(followUpDraft.tone)} tone drafted for ${followUpDraft.days_overdue ?? daysPastDue(selected)} day(s) overdue.`
                    : 'This invoice is overdue, so AI is preparing a customer-ready collection email.'}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={followUpPending && followUpInvoiceId === String(selected.id || '')}
                  onClick={() => onGenerateFollowUp(selected)}
                >
                  {followUpPending && followUpInvoiceId === String(selected.id || '') ? 'Drafting...' : 'Regenerate'}
                </Button>
                <Button size="sm" onClick={() => void onCopyFollowUp()} disabled={!followUpDraft}>
                  Copy Draft
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {followUpError ? (
                <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{followUpError}</div>
              ) : null}
              {followUpDraft ? (
                <>
                  <div className="rounded-lg border border-border bg-background px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</div>
                    <div className="mt-2 text-sm font-medium">{followUpDraft.subject}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</div>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-foreground">{followUpDraft.body}</pre>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AR Notes</div>
                    <div className="mt-2 space-y-2">
                      {(followUpDraft.key_points || []).map((point, index) => (
                        <div key={`${point}-${index}`} className="text-sm text-foreground">{point}</div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  {followUpPending && followUpInvoiceId === String(selected.id || '') ? 'Generating follow-up draft...' : 'Open an overdue invoice to generate a follow-up.'}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        <DetailField label="Invoice #" value={draft.invoiceNumber || draft.invoice_number} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, invoiceNumber: v }))} />
        <DetailField label="Customer" value={draft.customerName || draft.customer_name} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, customerName: v }))} />
        <div className="flex items-start gap-3">
          <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Order Date</span>
          <span className="text-sm">{formatDate(selected.created_at || selected.issuedDate || selected.issued_date)}</span>
        </div>
        <DetailField label="Amount" value={String(draft.amount ?? '')} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
        <div className="flex items-start gap-3">
          <span className="w-32 shrink-0 pt-1 text-sm text-muted-foreground">Status</span>
          {editing ? (
            <SelectInput value={draft.status || ''} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="flex-1">
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="void">Voided</option>
            </SelectInput>
          ) : (
            <span className="text-sm capitalize">{selected.status || '-'}</span>
          )}
        </div>
        <DetailField label="Due Date" value={draft.dueDate || draft.due_date} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, dueDate: v }))} />
        <DetailField label="Notes" value={draft.notes} editing={editing} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} multiline />

        {(selected.lot_numbers && selected.lot_numbers.length > 0) && (
          <div className="space-y-2">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lot Numbers</span>
            <div className="overflow-hidden rounded-md border border-border">
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
    </SlideOver>
  );
}
