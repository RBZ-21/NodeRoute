'use strict';

const { createMailer } = require('./email');
const { buildInvoicePDF } = require('./pdf');
const { loadInvoiceDocument, snapshotInvoiceDocument } = require('./invoice-document');
const { statusAfterInvoiceEmail } = require('./invoice-delivery');
const { scopeQueryByContext } = require('./operating-context');
const { supabase } = require('./supabase');
const { escapeHtml } = require('../lib/html');

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '$0.00';
}

function quantity(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '0';
}

function renderInvoiceEmailHtml(document = {}) {
  const seller = document.seller || {};
  const soldTo = document.soldTo || {};
  const metadata = document.metadata || {};
  const items = Array.isArray(document.items) ? document.items : [];
  const totals = document.totals || {};

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;color:#172033">
      <div style="border-top:5px solid #ff6b35;padding-top:20px">
        <h2 style="margin:0;color:#172033">${escapeHtml(seller.businessName || 'NodeRoute Systems')}</h2>
        <p style="margin:6px 0 0;color:#64748b">Invoice ${escapeHtml(metadata.invoiceNumber || '')}</p>
      </div>
      <p style="margin:24px 0 8px">Hi ${escapeHtml(soldTo.name || 'there')},</p>
      <p style="margin:0 0 20px;color:#475569">Your invoice is attached. Here is a summary of the items ordered.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
        <thead>
          <tr style="background:#172033;color:#ffffff">
            <th style="padding:10px;text-align:left">Item ordered</th>
            <th style="padding:10px;text-align:right">Quantity</th>
            <th style="padding:10px;text-align:right">Line total</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `<tr>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.description || item.itemNumber || '-')}</td>
            <td style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(`${quantity(item.orderedQuantity)}${item.uom ? ` ${item.uom}` : ''}`)}</td>
            <td style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(money(item.extension))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p style="margin:0;text-align:right;font-size:18px"><strong>Invoice total: ${escapeHtml(money(totals.total))}</strong></p>
    </div>`;
}

async function sendInvoiceEmail(inv, subjectPrefix = 'Your Invoice') {
  const document = await loadInvoiceDocument(inv);
  const recipient = inv?.billing_email || inv?.customer_email || document?.soldTo?.email;
  if (!recipient) {
    return { sent: false, error: 'No email on file for this customer' };
  }

  const mailer = createMailer();
  if (!mailer) {
    return { sent: false, error: 'Email not configured on server' };
  }

  const businessName = document?.seller?.businessName || 'NodeRoute Systems';
  const invoiceLabel = document?.metadata?.invoiceNumber || String(inv?.id || '').slice(0, 8).toUpperCase();
  const pdfBuffer = await buildInvoicePDF(inv, document);

  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: recipient,
    subject: `${subjectPrefix} ${invoiceLabel} from ${businessName}`,
    html: renderInvoiceEmailHtml(document),
    attachments: [{
      filename: `invoice-${invoiceLabel}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  const nextStatus = statusAfterInvoiceEmail(inv.status);
  const context = { companyId: inv.company_id || null, locationId: inv.location_id || null };
  let updateQuery = supabase.from('invoices').update({
    status: nextStatus,
    sent_at: new Date().toISOString(),
    document_snapshot: snapshotInvoiceDocument(document),
  });
  if (context.companyId) updateQuery = scopeQueryByContext(updateQuery, context);
  const { error } = await updateQuery.eq('id', inv.id);
  if (error) throw error;

  return { sent: true, status: nextStatus };
}

module.exports = { renderInvoiceEmailHtml, sendInvoiceEmail };
