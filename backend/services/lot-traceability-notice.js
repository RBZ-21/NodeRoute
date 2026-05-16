function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeRecipient(value) {
  const email = normalizeString(value);
  if (!email) return '';
  return email.toLowerCase();
}

function formatDate(value) {
  const raw = normalizeString(value);
  if (!raw) return 'Unknown date';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatQty(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return '0';
  return qty.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function groupLotNoticeRecipients(orders) {
  const grouped = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    const recipientKey = normalizeRecipient(order?.customer_email);
    if (!recipientKey) continue;

    const existing = grouped.get(recipientKey) || {
      recipient: normalizeString(order?.customer_email),
      customerName: normalizeString(order?.customer) || 'there',
      orders: [],
    };

    if (existing.customerName === 'there') {
      existing.customerName = normalizeString(order?.customer) || existing.customerName;
    }
    existing.orders.push(order);
    grouped.set(recipientKey, existing);
  }

  return Array.from(grouped.values());
}

function buildLotNoticeEmail({ businessName, lot, customerName, orders, sentAt = new Date() }) {
  const safeBusinessName = normalizeString(businessName) || 'NodeRoute Systems';
  const safeCustomerName = normalizeString(customerName) || 'there';
  const safeLotNumber = normalizeString(lot?.lot_number) || 'Unknown lot';
  const safeProduct = normalizeString(lot?.product || lot?.product_id) || 'Tracked product';
  const safeVendor = normalizeString(lot?.vendor) || 'Unknown vendor';
  const receivedDate = formatDate(lot?.received_date);
  const totalQty = (Array.isArray(orders) ? orders : []).reduce((sum, order) => {
    const qty = Number(order?.quantity);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
  const orderRows = (Array.isArray(orders) ? orders : []).map((order) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(order?.order_number || order?.order_id || 'Order')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(formatQty(order?.quantity))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(formatDate(order?.delivery_date))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(normalizeString(order?.status) || 'Unknown')}</td>
    </tr>
  `).join('');

  const summaryLine = `${safeProduct} lot ${safeLotNumber} from ${safeVendor}`;
  const textOrders = (Array.isArray(orders) ? orders : []).map((order) =>
    `- ${normalizeString(order?.order_number || order?.order_id || 'Order')}: ${formatQty(order?.quantity)} units on ${formatDate(order?.delivery_date)} (${normalizeString(order?.status) || 'unknown'})`
  ).join('\n');

  return {
    subject: `${safeBusinessName}: Traceability notice for lot ${safeLotNumber}`,
    text: [
      `Hi ${safeCustomerName},`,
      '',
      `This is a traceability notice for ${summaryLine}.`,
      `Our records show ${formatQty(totalQty)} units from this lot on your recent order${(orders || []).length === 1 ? '' : 's'}.`,
      `Lot received: ${receivedDate}`,
      '',
      'Affected orders:',
      textOrders || '- No order details available',
      '',
      'Please contact us if you need any additional traceability documentation.',
      '',
      `${safeBusinessName}`,
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;color:#111827">
        <h2 style="color:#ff6b35;margin-bottom:8px">${escapeHtml(safeBusinessName)}</h2>
        <p>Hi ${escapeHtml(safeCustomerName)},</p>
        <p>This is a traceability notice for <strong>${escapeHtml(summaryLine)}</strong>.</p>
        <p>Our records show <strong>${escapeHtml(formatQty(totalQty))}</strong> units from this lot on your recent order${(orders || []).length === 1 ? '' : 's'}.</p>
        <div style="margin:16px 0;padding:12px 14px;border:1px solid #fed7aa;background:#fff7ed;border-radius:8px">
          <div><strong>Lot Number:</strong> ${escapeHtml(safeLotNumber)}</div>
          <div><strong>Product:</strong> ${escapeHtml(safeProduct)}</div>
          <div><strong>Vendor:</strong> ${escapeHtml(safeVendor)}</div>
          <div><strong>Received:</strong> ${escapeHtml(receivedDate)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr style="background:#fff1eb">
            <th style="padding:8px;text-align:left">Order</th>
            <th style="padding:8px;text-align:left">Qty from Lot</th>
            <th style="padding:8px;text-align:left">Date</th>
            <th style="padding:8px;text-align:left">Status</th>
          </tr>
          ${orderRows || '<tr><td colspan="4" style="padding:8px;border-bottom:1px solid #eee">No order details available</td></tr>'}
        </table>
        <p>Please contact us if you need any additional traceability documentation.</p>
        <p style="color:#6b7280;font-size:12px">Sent ${escapeHtml(formatDate(sentAt))}</p>
      </div>
    `,
  };
}

module.exports = {
  buildLotNoticeEmail,
  groupLotNoticeRecipients,
};
