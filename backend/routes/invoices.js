const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { createMailer } = require('../services/email');
const { buildInvoicePDF } = require('../services/pdf');

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('invoices').select('*').order('created_at', { ascending: false }), res);
  if (!data) return;
  res.json(data);
});

router.post('/', authenticateToken, async (req, res) => {
  const { invoice_number, customer_name, customer_email, customer_address, items, subtotal, tax, total, driver_name, notes, entree_invoice_id } = req.body;
  if (!customer_name) return res.status(400).json({ error: 'Customer name required' });
  const data = await dbQuery(supabase.from('invoices').insert([{ invoice_number, customer_name, customer_email, customer_address, items: items||[], subtotal: subtotal||0, tax: tax||0, total: total||0, status: 'pending', driver_name, notes, entree_invoice_id }]).select().single(), res);
  if (!data) return;
  res.json(data);
});

// Entree import — accepts one or many invoices in Entree's export format
router.post('/import', authenticateToken, async (req, res) => {
  const raw = Array.isArray(req.body) ? req.body : [req.body];
  const mapped = raw.map(e => ({
    invoice_number:   e.InvoiceNumber || e.invoice_number || null,
    customer_name:    e.CustomerName  || e.customer_name  || e.BillTo || '',
    customer_email:   e.Email         || e.customer_email || '',
    customer_address: e.Address       || e.customer_address || '',
    items: (e.Items || e.LineItems || e.items || []).map(i => ({
      description: i.Description || i.description || i.Item || '',
      quantity:    i.Quantity    || i.quantity    || 1,
      unit_price:  i.UnitPrice   || i.unit_price  || i.Price || 0,
      total:       i.Total       || i.total       || (i.Quantity * i.UnitPrice) || 0,
    })),
    subtotal:          e.Subtotal  || e.subtotal  || 0,
    tax:               e.Tax       || e.tax       || 0,
    total:             e.Total     || e.total     || e.InvoiceTotal || 0,
    driver_name:       e.Driver    || e.driver    || '',
    notes:             e.Notes     || e.notes     || '',
    entree_invoice_id: e.InvoiceNumber || e.InvoiceID || null,
    status: 'pending',
  }));
  const data = await dbQuery(supabase.from('invoices').insert(mapped).select(), res);
  if (!data) return;
  res.json({ imported: data.length, invoices: data });
});

// Save signature → generate PDF → email customer
router.post('/:id/sign', authenticateToken, async (req, res) => {
  const { signature_data } = req.body; // base64 PNG from canvas
  if (!signature_data) return res.status(400).json({ error: 'Signature data required' });

  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  // Update invoice as signed
  const updated = await dbQuery(supabase.from('invoices').update({ signature_data, status: 'signed', signed_at: new Date().toISOString() }).eq('id', req.params.id).select().single(), res);
  if (!updated) return;

  // Generate PDF
  const pdfBuffer = await buildInvoicePDF({ ...updated });

  // Send email if customer has one
  let emailSent = false;
  if (inv.customer_email) {
    try {
      const mailer = createMailer();
      if (mailer) {
        await mailer.sendMail({
          from: process.env.EMAIL_FROM || `NodeRoute Systems <${process.env.SMTP_USER}>`,
          to: inv.customer_email,
          subject: `Your Invoice ${inv.invoice_number || inv.id.slice(0,8).toUpperCase()} from NodeRoute`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px">
              <h2 style="color:#ff6b35">NodeRoute Systems</h2>
              <p>Hi ${inv.customer_name},</p>
              <p>Thank you for your order. Please find your signed invoice attached.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:right">Price</th><th style="padding:8px;text-align:right">Total</th></tr>
                ${(inv.items||[]).map(i=>`<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.description}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">${i.quantity}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">$${parseFloat(i.unit_price).toFixed(2)}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">$${parseFloat(i.total).toFixed(2)}</td></tr>`).join('')}
              </table>
              <p style="text-align:right"><strong>Total: $${parseFloat(inv.total).toFixed(2)}</strong></p>
              <p style="color:#888;font-size:12px">Signed on ${new Date().toLocaleString()}</p>
            </div>`,
          attachments: [{ filename: `invoice-${inv.invoice_number || inv.id.slice(0,8)}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailSent = true;
        await supabase.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id);
      }
    } catch (e) {
      console.error('Email error:', e.message);
    }
  }

  res.json({ ...updated, status: emailSent ? 'sent' : 'signed', emailSent });
});

// Resend email for an already-signed invoice
router.post('/:id/resend', authenticateToken, async (req, res) => {
  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!inv.signature_data) return res.status(400).json({ error: 'Invoice not yet signed' });
  if (!inv.customer_email) return res.status(400).json({ error: 'No email on file for this customer' });
  const mailer = createMailer();
  if (!mailer) return res.status(503).json({ error: 'Email not configured on server' });
  const pdfBuffer = await buildInvoicePDF(inv);
  await mailer.sendMail({
    from: `NodeRoute Systems <${process.env.SMTP_USER}>`,
    to: inv.customer_email,
    subject: `Invoice ${inv.invoice_number || inv.id.slice(0,8).toUpperCase()} (Resent)`,
    html: `<p>Hi ${inv.customer_name}, please find your invoice attached.</p>`,
    attachments: [{ filename: `invoice-${inv.invoice_number || inv.id.slice(0,8)}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });
  await supabase.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id);
  res.json({ message: 'Email resent' });
});

// Download PDF for any invoice
router.get('/:id/pdf', authenticateToken, async (req, res) => {
  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const pdfBuffer = await buildInvoicePDF(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_number || inv.id.slice(0,8)}.pdf"`);
  res.send(pdfBuffer);
});

module.exports = router;
