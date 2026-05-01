const express = require('express');
const { z } = require('zod');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { createMailer } = require('../services/email');
const { buildInvoicePDF } = require('../services/pdf');
const { loadCompanySettings } = require('../services/company-settings');
const { loadDriverInvoiceScope } = require('../services/driver-invoice-access');
const { validateBody } = require('../lib/zod-validate');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

const DEFAULT_TAX_RATE = 0.09;
const MAX_INVOICE_ITEMS = 200;

const invoiceBodySchema = z.object({
  customer_name: z.string().trim().min(1, 'customer_name is required').max(200).optional(),
  customerName: z.string().trim().min(1, 'customer_name is required').max(200).optional(),
  customer_email: z.string().max(200).optional().nullable(),
  customerEmail: z.string().max(200).optional().nullable(),
  customer_address: z.string().max(500).optional().nullable(),
  customerAddress: z.string().max(500).optional().nullable(),
  deliveryAddress: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(z.any(), { error: 'items must be an array' }).min(1, 'items is required').max(MAX_INVOICE_ITEMS, `items may contain at most ${MAX_INVOICE_ITEMS} items`),
  subtotal: z.union([z.number(), z.string()]).optional(),
  total: z.union([z.number(), z.string()]).optional(),
}).passthrough().superRefine((body, ctx) => {
  const customerName = invoiceBodyValue(body, 'customer_name', 'customerName');
  if (!customerName || !String(customerName).trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'customer_name is required' });
  }

  if (body.subtotal !== undefined && !Number.isFinite(Number(body.subtotal))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'subtotal must be a number' });
  }

  if (body.total !== undefined && !Number.isFinite(Number(body.total))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'total must be a number' });
  }
});

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function asMoney(value) {
  return parseFloat((parseFloat(value || 0) || 0).toFixed(2));
}

function invoiceBodyValue(body, ...keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') return body[key];
  }
  return null;
}

function normalizeInvoiceItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const quantity = parseFloat(item.quantity || item.qty || 0) || 0;
    const unitPrice = parseFloat(item.unit_price ?? item.unitPrice ?? item.price ?? 0) || 0;
    return {
      description: item.description || item.name || '',
      notes: item.notes || null,
      quantity,
      unit: item.unit || null,
      unit_price: unitPrice,
      total: asMoney(item.total || quantity * unitPrice),
    };
  });
}

async function canDriverAccessInvoice(req, invoice) {
  if (!req.user || req.user.role !== 'driver') return true;
  if (!invoice?.id) return false;
  const scope = await loadDriverInvoiceScope(supabase, req.user, req.context);
  return scope.assignedInvoiceIds.has(invoice.id);
}

async function canAccessInvoice(req, invoice) {
  if (req.user?.role === 'driver') return canDriverAccessInvoice(req, invoice);
  return rowMatchesContext(invoice, req.context);
}

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

router.get('/', authenticateToken, async (req, res) => {
  if (req.user.role === 'driver') {
    try {
      const scope = await loadDriverInvoiceScope(supabase, req.user, req.context);
      return res.json(scope.invoices);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  const data = await dbQuery(supabase.from('invoices').select('*').order('created_at', { ascending: false }), res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), validateBody(invoiceBodySchema), async (req, res) => {
  const body = req.validated.body;
  const customer_name = invoiceBodyValue(body, 'customer_name', 'customerName');
  const items = normalizeInvoiceItems(body.items);
  const subtotal = body.subtotal !== undefined
    ? asMoney(body.subtotal)
    : asMoney(items.reduce((sum, item) => sum + item.total, 0));
  const taxEnabled = parseBoolean(body.tax_enabled ?? body.taxEnabled);
  const taxRate = parseFloat(body.tax_rate ?? body.taxRate);
  const normalizedTaxRate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : DEFAULT_TAX_RATE;
  const tax = body.tax !== undefined ? asMoney(body.tax) : (taxEnabled ? asMoney(subtotal * normalizedTaxRate) : 0);
  const total = body.total !== undefined ? asMoney(body.total) : asMoney(subtotal + tax);
  const insertResult = await insertRecordWithOptionalScope(supabase, 'invoices', {
    invoice_number: invoiceBodyValue(body, 'invoice_number', 'invoiceNumber') || `INV-${Date.now().toString().slice(-6)}`,
    customer_name,
    customer_email: invoiceBodyValue(body, 'customer_email', 'customerEmail') || null,
    customer_address: invoiceBodyValue(body, 'customer_address', 'customerAddress', 'deliveryAddress') || null,
    billing_name: invoiceBodyValue(body, 'billing_name', 'billingName') || null,
    billing_contact: invoiceBodyValue(body, 'billing_contact', 'billingContact') || null,
    billing_email: invoiceBodyValue(body, 'billing_email', 'billingEmail') || null,
    billing_phone: invoiceBodyValue(body, 'billing_phone', 'billingPhone') || null,
    billing_address: invoiceBodyValue(body, 'billing_address', 'billingAddress') || null,
    items,
    subtotal,
    tax,
    total,
    tax_enabled: taxEnabled,
    tax_rate: normalizedTaxRate,
    order_id: invoiceBodyValue(body, 'order_id', 'orderId'),
    status: 'pending',
    driver_name: invoiceBodyValue(body, 'driver_name', 'driverName'),
    driver_id: invoiceBodyValue(body, 'driver_id', 'driverId'),
    notes: body.notes || null,
    entree_invoice_id: body.entree_invoice_id || null,
  }, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return;
  res.json(data);
});

// Entree import — accepts one or many invoices in Entree's export format
router.post('/import', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  if (!Array.isArray(req.body) && (typeof req.body !== 'object' || req.body === null)) {
    return res.status(400).json({ error: 'Request body must be an invoice object or an array of invoices' });
  }
  const raw = Array.isArray(req.body) ? req.body : [req.body];
  if (raw.length === 0) return res.status(400).json({ error: 'At least one invoice is required' });
  if (raw.length > 500) return res.status(400).json({ error: 'Batch size limit is 500 invoices per request' });
  const missingIdx = raw.findIndex((e) => !((e.CustomerName || e.customer_name || e.BillTo || '').trim()));
  if (missingIdx >= 0) return res.status(400).json({ error: `Invoice at index ${missingIdx} is missing customer_name` });
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
  const data = await dbQuery(supabase.from('invoices').insert(mapped.map(inv => ({
    ...inv,
    ...buildScopeFields(req.context),
  }))).select(), res);
  if (!data) return;
  res.json({ imported: data.length, invoices: data });
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!rowMatchesContext(inv, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const updates = {};
  if (req.body.status !== undefined) {
    const nextStatus = String(req.body.status || '').trim().toLowerCase();
    if (!['pending', 'paid', 'overdue', 'void', 'signed', 'sent'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid invoice status' });
    }
    updates.status = nextStatus;
    if (nextStatus === 'paid') {
      updates.paid_date = new Date().toISOString();
    }
  }
  if (req.body.notes !== undefined) updates.notes = req.body.notes || null;
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid invoice fields provided' });
  }

  const data = await dbQuery(
    supabase.from('invoices').update(updates).eq('id', req.params.id).select().single(),
    res
  );
  if (!data) return;
  res.json(data);
});

// Save signature → generate PDF → email customer
router.post('/:id/sign', authenticateToken, async (req, res) => {
  const signature_data = req.body?.signature_data || req.body?.signature; // base64 PNG from canvas
  if (!signature_data) return res.status(400).json({ error: 'Signature data required' });

  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!(await canAccessInvoice(req, inv))) return res.status(403).json({ error: 'Forbidden' });

  // Update invoice as signed
  const updated = await dbQuery(supabase.from('invoices').update({ signature_data, status: 'signed', signed_at: new Date().toISOString() }).eq('id', req.params.id).select().single(), res);
  if (!updated) return;

  // Generate PDF
  let emailSent = false;
  if (inv.billing_email || inv.customer_email) {
    try {
      const emailResult = await sendInvoiceEmail({ ...updated, billing_email: inv.billing_email, customer_email: inv.customer_email }, 'Your Signed Invoice');
      emailSent = emailResult.sent;
      if (emailSent) {
        await supabase.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id);
      }
    } catch (e) {
      console.error('Email error:', e.message);
    }
  }

  res.json({ ...updated, status: emailSent ? 'sent' : 'signed', emailSent });
});

router.post('/:id/email', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!rowMatchesContext(inv, req.context)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await sendInvoiceEmail(inv);
    if (!result.sent) {
      return res.status(result.error === 'Email not configured on server' ? 503 : 400).json({ error: result.error });
    }
    res.json({ message: 'Invoice emailed successfully', status: result.status });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to email invoice' });
  }
});

// Resend email for an already-signed invoice
router.post('/:id/resend', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!rowMatchesContext(inv, req.context)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await sendInvoiceEmail(inv, 'Invoice');
    if (!result.sent) {
      return res.status(result.error === 'Email not configured on server' ? 503 : 400).json({ error: result.error });
    }
    res.json({ message: 'Email resent', status: result.status });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to resend invoice' });
  }
});

// Download PDF for any invoice
router.get('/:id/pdf', authenticateToken, async (req, res) => {
  const inv = await dbQuery(supabase.from('invoices').select('*').eq('id', req.params.id).single(), res);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!(await canAccessInvoice(req, inv))) return res.status(403).json({ error: 'Forbidden' });
  const pdfBuffer = await buildInvoicePDF(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_number || inv.id.slice(0,8)}.pdf"`);
  res.send(pdfBuffer);
});

module.exports = router;
