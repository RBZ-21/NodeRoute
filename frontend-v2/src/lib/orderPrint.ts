import { asNumber, orderItemQty } from '../pages/orders.types';
import type { Order } from '../pages/orders.types';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Opens a blank popup immediately (before the order data is ready) so the
 * browser doesn't treat the later `printOrderSlip` call as a blocked
 * pop-up — it has to happen synchronously with the user's click.
 */
export function openPrintWindow(): Window | null {
  const popup = window.open('', '_blank', 'width=960,height=720');
  if (popup) {
    popup.document.write('<!DOCTYPE html><html><head><title>Preparing order...</title></head><body style="font-family:Arial,sans-serif;padding:24px">Preparing order for print...</body></html>');
    popup.document.close();
  }
  return popup;
}

export function printOrderSlip(order: Order, popup: Window | null) {
  if (!popup) return;
  const rows = (order.items || []).map((item) => {
    const qty = orderItemQty(item);
    const unit = item.is_catch_weight ? 'lb' : String(item.unit || '').toLowerCase() === 'lb' ? 'lb' : 'ea';
    const price = item.is_catch_weight ? asNumber(item.price_per_lb) : asNumber(item.unit_price);
    return `<tr>
      <td>${escapeHtml(item.name || item.description || item.item_number || '—')}</td>
      <td>${escapeHtml(item.notes || '')}</td>
      <td>${escapeHtml(qty.toFixed(unit === 'lb' ? 2 : 0))} ${unit}</td>
      <td>$${price.toFixed(2)}</td>
    </tr>`;
  }).join('');
  const orderNumber = order.order_number || order.id.slice(0, 8);
  popup.document.open();
  popup.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Order ${escapeHtml(orderNumber)}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin-bottom:4px}
    .muted{color:#666;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th{background:#f5f5f5;padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;color:#666}
    td{padding:8px 12px;border-bottom:1px solid #e6e6e6;vertical-align:top}
    .print-actions{display:flex;justify-content:flex-end;margin-bottom:16px}
    .print-btn{background:#3dba7f;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px}
    @media print {.print-actions{display:none} body{padding:0.4in}}
  </style>
</head>
<body>
  <div class="print-actions"><button class="print-btn" onclick="window.print()">Print</button></div>
  <h1>Order ${escapeHtml(orderNumber)}</h1>
  <div class="muted">${escapeHtml(order.customer_name || 'No customer')} · ${escapeHtml(order.customer_address || '')}</div>
  <div class="muted" style="font-size:12px;margin-top:2px">${escapeHtml(new Date().toLocaleString())}</div>
  <table>
    <thead><tr><th>Item</th><th>Notes</th><th>Quantity</th><th>Price</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center">No line items</td></tr>'}</tbody>
  </table>
</body>
</html>`);
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 300);
}
