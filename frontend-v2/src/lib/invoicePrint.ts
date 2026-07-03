import type { InvoiceLotEntry } from '../hooks/useInvoices';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Opens a print-ready popup summarizing one invoice and its lot detail.
 * All display values are passed in pre-formatted so this module has no
 * dependency on the page's own formatting/lookup helpers.
 */
export function printInvoiceSummary({
  invoiceId,
  customerName,
  orderId,
  status,
  amount,
  issuedDate,
  dueDate,
  notes,
  lots,
  totalQty,
  totalWeight,
}: {
  invoiceId: string;
  customerName: string;
  orderId: string;
  status: string;
  amount: string;
  issuedDate: string;
  dueDate: string;
  notes: string;
  lots: InvoiceLotEntry[];
  totalQty: number;
  totalWeight: number;
}): void {
  const popup = window.open('', '_blank', 'width=1100,height=900');
  if (!popup) return;

  const rows = lots.length
    ? lots.map((lot) => `
        <tr>
          <td>${escapeHtml(lot.item_number || '-')}</td>
          <td>${escapeHtml(lot.description || '-')}</td>
          <td>${escapeHtml(lot.lot_number || '-')}</td>
          <td class="num">${escapeHtml(lot.qty ?? '-')}</td>
          <td class="num">${lot.weight != null ? `${escapeHtml(lot.weight)} lbs` : '-'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="empty">No lot details were recorded for this invoice.</td></tr>';

  popup.document.write(`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Invoice ${escapeHtml(invoiceId)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 28px; color: #111827; }
          h1 { margin: 0 0 6px; font-size: 28px; }
          .subtitle { color: #4b5563; margin-bottom: 20px; }
          .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
          .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px 14px; background: #f9fafb; }
          .label { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
          .value { margin-top: 4px; font-size: 18px; font-weight: 700; color: #111827; }
          .notes { margin: 20px 0; padding: 14px; border-radius: 10px; border: 1px solid #d1d5db; background: #f9fafb; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 10px 12px; text-align: left; font-size: 12px; }
          th { background: #eef2ff; }
          .num { text-align: right; }
          .empty { color: #6b7280; text-align: center; }
          @media print { body { margin: 14px; } }
        </style>
      </head>
      <body>
        <h1>Invoice ${escapeHtml(invoiceId)}</h1>
        <div class="subtitle">${escapeHtml(customerName)} · Order ${escapeHtml(orderId || '-')}</div>
        <div class="summary">
          <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(status)}</div></div>
          <div class="card"><div class="label">Amount</div><div class="value">${escapeHtml(amount)}</div></div>
          <div class="card"><div class="label">Issued / Due</div><div class="value">${escapeHtml(issuedDate)} / ${escapeHtml(dueDate)}</div></div>
          <div class="card"><div class="label">Lots</div><div class="value">${lots.length.toLocaleString()}</div></div>
          <div class="card"><div class="label">Requested Qty</div><div class="value">${totalQty.toLocaleString()}</div></div>
          <div class="card"><div class="label">Weight Total</div><div class="value">${totalWeight.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} lbs</div></div>
        </div>
        <div class="notes"><strong>Notes:</strong> ${escapeHtml(notes || 'No invoice notes recorded.')}</div>
        <h2>Lot Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Item #</th>
              <th>Description</th>
              <th>Lot #</th>
              <th class="num">Qty</th>
              <th class="num">Weight</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}
