import { ActionMenu } from '../components/ui/action-menu';
import { Button } from '../components/ui/button';
import { PaginationControls } from '../components/ui/pagination';
import { SelectInput } from '../components/ui/select-input';
import { StatusBadge } from '../components/ui/status-badge';
import { TableEmptyState } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import type { Invoice } from '../hooks/useInvoices';
import type { LatePaymentRisk } from '../hooks/useAI';

type InvoiceStatus = 'pending' | 'sent' | 'delivered' | 'paid' | 'overdue' | 'void' | 'other';
type InvoiceBulkStatus = Exclude<InvoiceStatus, 'other'>;

const statusColors = {
  pending: 'gray',
  sent: 'blue',
  delivered: 'green',
  paid: 'green',
  overdue: 'red',
  void: 'gray',
} as const;

const riskColors = {
  high: 'red',
  medium: 'yellow',
  low: 'green',
} as const;

export function InvoiceTable({
  rows,
  emptyMessage,
  selectable = false,
  pagination,
  onPageSizeChange,
  riskByCustomer,
  selectedInvoiceIds,
  onToggleInvoiceSelected,
  bulkUpdatingInvoices,
  allVisibleInvoicesSelected,
  onToggleAllVisibleInvoices,
  selectedVisibleCount,
  activeInvoiceCount,
  bulkInvoiceStatus,
  onBulkInvoiceStatusChange,
  onApplyBulkInvoiceStatus,
  updateInvoicePending,
  markingDeliveredInvoiceId,
  markingPaidInvoiceId,
  resendInvoiceEmailPending,
  invoiceFollowUpPending,
  followUpInvoiceId,
  onOpenInvoice,
  onMarkDelivered,
  onMarkPaid,
  onResend,
  onGenerateFollowUp,
  onCreateOrder,
  invoiceId,
  customerName,
  formatAmount,
  formatDate,
  lotSummary,
  normalizeStatus,
  invoiceActivityDate,
  shouldSuggestFollowUp,
}: {
  rows: Invoice[];
  emptyMessage: string;
  selectable?: boolean;
  pagination?: {
    page: number;
    pageCount: number;
    setPage: (page: number) => void;
    itemCount: number;
    pageSize: number;
  };
  onPageSizeChange?: (pageSize: number) => void;
  riskByCustomer: Map<string, LatePaymentRisk>;
  selectedInvoiceIds: Set<string>;
  onToggleInvoiceSelected: (invoice: Invoice, checked: boolean) => void;
  bulkUpdatingInvoices: boolean;
  allVisibleInvoicesSelected: boolean;
  onToggleAllVisibleInvoices: (checked: boolean) => void;
  selectedVisibleCount: number;
  activeInvoiceCount: number;
  bulkInvoiceStatus: InvoiceBulkStatus;
  onBulkInvoiceStatusChange: (status: InvoiceBulkStatus) => void;
  onApplyBulkInvoiceStatus: () => void;
  updateInvoicePending: boolean;
  markingDeliveredInvoiceId: string | null;
  markingPaidInvoiceId: string | null;
  resendInvoiceEmailPending: boolean;
  invoiceFollowUpPending: boolean;
  followUpInvoiceId: string | null;
  onOpenInvoice: (invoice: Invoice) => void;
  onMarkDelivered: (invoice: Invoice) => void;
  onMarkPaid: (invoice: Invoice) => void;
  onResend: (invoice: Invoice) => void;
  onGenerateFollowUp: (invoice: Invoice) => void;
  onCreateOrder: () => void;
  invoiceId: (inv: Invoice) => string;
  customerName: (inv: Invoice) => string;
  formatAmount: (val: number | string | undefined) => string;
  formatDate: (val: string | undefined) => string;
  lotSummary: (lots: Invoice['lot_numbers']) => string;
  normalizeStatus: (value: string | undefined) => InvoiceStatus;
  invoiceActivityDate: (invoice: Invoice) => string | undefined;
  shouldSuggestFollowUp: (invoice: Invoice) => boolean;
}) {
  function renderRows() {
    return rows.length ? rows.map((inv) => {
      const status = normalizeStatus(inv.status);
      const isDelivered = status === 'delivered';
      const isPaid = status === 'paid';
      const risk = riskByCustomer.get(customerName(inv).toLowerCase());
      const selectableId = String(inv.id || '');
      return (
        <TableRow key={invoiceId(inv)}>
          {selectable ? (
            <TableCell>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean(selectableId && selectedInvoiceIds.has(selectableId))}
                onChange={(event) => onToggleInvoiceSelected(inv, event.target.checked)}
                aria-label={`Select invoice ${invoiceId(inv)}`}
                disabled={!selectableId || bulkUpdatingInvoices}
              />
            </TableCell>
          ) : null}
          <TableCell className="font-medium whitespace-nowrap">{invoiceId(inv)}</TableCell>
          <TableCell className="max-w-[140px] truncate">{customerName(inv)}</TableCell>
          <TableCell className="hidden sm:table-cell">
            {risk ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={risk.risk_level.toLowerCase()} colorMap={riskColors} fallbackLabel={risk.risk_level} />
                <span className="text-xs text-muted-foreground">{risk.risk_score}</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">No flag</span>
            )}
          </TableCell>
          <TableCell className="hidden sm:table-cell">{inv.orderNumber || inv.order_number || inv.orderId || inv.order_id || '-'}</TableCell>
          <TableCell className="hidden sm:table-cell font-mono text-xs">{lotSummary(inv.lot_numbers)}</TableCell>
          <TableCell className="whitespace-nowrap">{formatAmount(inv.amount)}</TableCell>
          <TableCell><StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
          <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(invoiceActivityDate(inv))}</TableCell>
          <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(inv.dueDate || inv.due_date)}</TableCell>
          <TableCell className="hidden md:table-cell whitespace-nowrap">{formatDate(inv.paidDate || inv.paid_date)}</TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              <Button size="sm" className="whitespace-nowrap" onClick={() => onOpenInvoice(inv)}>View / Edit</Button>
              <ActionMenu
                items={[
                  {
                    label: updateInvoicePending && markingDeliveredInvoiceId === String(inv.id || '') ? 'Saving...' : 'Delivered',
                    onClick: () => onMarkDelivered(inv),
                    disabled: isDelivered || isPaid || (updateInvoicePending && markingDeliveredInvoiceId === String(inv.id || '')),
                  },
                  {
                    label: updateInvoicePending && markingPaidInvoiceId === String(inv.id || '') ? 'Saving...' : 'PAID',
                    onClick: () => onMarkPaid(inv),
                    disabled: isPaid || (updateInvoicePending && markingPaidInvoiceId === String(inv.id || '')),
                  },
                  {
                    label: resendInvoiceEmailPending ? 'Sending...' : 'Resend Email',
                    onClick: () => onResend(inv),
                    disabled: resendInvoiceEmailPending,
                  },
                  {
                    label: invoiceFollowUpPending && followUpInvoiceId === String(inv.id || '') ? 'Drafting...' : 'AI Follow-Up',
                    onClick: () => onGenerateFollowUp(inv),
                    disabled: invoiceFollowUpPending && followUpInvoiceId === String(inv.id || ''),
                    hidden: !shouldSuggestFollowUp(inv),
                  },
                ]}
              />
            </div>
          </TableCell>
        </TableRow>
      );
    }) : (
      <TableEmptyState
        colSpan={selectable ? 12 : 11}
        title={emptyMessage}
        description={selectable ? 'Create an order to generate invoices for the selected day.' : 'Delivered invoices appear here after fulfillment is marked complete.'}
        actionLabel="Create Order"
        onAction={onCreateOrder}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      {selectable ? (
        <div className="flex flex-col gap-2 border-b border-border bg-muted/20 p-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allVisibleInvoicesSelected}
              onChange={(event) => onToggleAllVisibleInvoices(event.target.checked)}
              aria-label="Select all visible invoices"
              disabled={!activeInvoiceCount || bulkUpdatingInvoices}
            />
            Select All
            <span className="text-xs font-normal text-muted-foreground">
              {selectedVisibleCount} selected
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <SelectInput
              value={bulkInvoiceStatus}
              onChange={(event) => onBulkInvoiceStatusChange(event.target.value as InvoiceBulkStatus)}
              className="h-9 px-2"
              aria-label="Bulk invoice status"
              disabled={!selectedVisibleCount || bulkUpdatingInvoices}
            >
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="void">Voided</option>
            </SelectInput>
            <Button
              variant="outline"
              size="sm"
              onClick={onApplyBulkInvoiceStatus}
              disabled={!selectedVisibleCount || bulkUpdatingInvoices}
            >
              {bulkUpdatingInvoices ? 'Updating...' : 'Apply Bulk Status'}
            </Button>
          </div>
        </div>
      ) : null}
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            {selectable ? (
              <TableHead className="w-10">
                <span className="sr-only">Select</span>
              </TableHead>
            ) : null}
            <TableHead>Invoice #</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="hidden sm:table-cell">AI Risk</TableHead>
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
        <TableBody>{renderRows()}</TableBody>
      </Table>
      {pagination && pagination.itemCount ? (
        <PaginationControls
          page={pagination.page}
          pageCount={pagination.pageCount}
          setPage={pagination.setPage}
          itemCount={pagination.itemCount}
          pageSize={pagination.pageSize}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}
