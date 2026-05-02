const { createMailer } = require('./email');
const { buildInvoicePDF } = require('./pdf');
const { loadCompanySettings } = require('./company-settings');
const { supabase } = require('./supabase');

async function sendInvoiceEmail(inv, subjectPrefix = 'Your Invoice') {
  const recipient = inv?.billing_email || inv?.customer_email;
  if (!recipient) {
    return { sent: false, error: 'No email on file for this customer' };
  }

  const mailer = createMailer();
  if (!mailer) {
    return { sent: false, error: 'Email not configured on server' };
  }

  const companySettings = await loadCompanySettings(inv.company_id, inv.company_name);
  const businessName = companySettings.businessName || 'NodeRoute Systems';
  const pdfBuffer = await buildInvoicePDF(inv);
  const invoiceLabel = inv.invoice_number || inv.id.slice(0, 8).toUpperCase();

  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: recipient,
    subject: `${subjectPrefix} ${invoiceLabel} from ${businessName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px">
        <h2 style="color:#ff6b35">${businessName}</h2>
        <p>Hi ${inv.customer_name || 'there'},</p>
        <p>Please find your invoice attached.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:right">Price</th><th style="padding:8px;text-align:right">Total</th></tr>
          ${(inv.items || []).map((i) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.description || ''}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">${i.quantity || 0}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">$${parseFloat(i.unit_price ?? i.unitPrice ?? 0).toFixed(2)}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">$${parseFloat(i.total || 0).toFixed(2)}</td></tr>`).join('')}
        </table>
        <p style="text-align:right"><strong>Total: $${parseFloat(inv.total || 0).toFixed(2)}</strong></p>
        <p style="color:#888;font-size:12px">Generated on ${new Date().toLocaleString()}</p>
      </div>`,
    attachments: [{ filename: `invoice-${inv.invoice_number || inv.id.slice(0, 8)}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });

  const nextStatus = inv.status === 'pending' ? 'pending' : 'sent';
  await supabase
    .from('invoices')
    .update({ status: nextStatus, sent_at: new Date().toISOString() })
    .eq('id', inv.id);

  return { sent: true, status: nextStatus };
}

module.exports = { sendInvoiceEmail };
