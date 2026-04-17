const express = require('express');
const jwt = require('jsonwebtoken');
const { supabase } = require('../services/supabase');
const { buildInvoicePDF } = require('../services/pdf');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

function signPortalJWT(email, name) {
  return jwt.sign({ email, name, role: 'customer' }, JWT_SECRET, { expiresIn: '24h' });
}

function authenticatePortalToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let payload;
  try {
    payload = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (payload.role !== 'customer') return res.status(403).json({ error: 'Forbidden' });
  req.customerEmail = payload.email;
  req.customerName = payload.name;
  next();
}

// POST /api/portal/auth — issue a 24h portal token if the email has invoices or orders
router.post('/auth', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const normalized = email.trim().toLowerCase();

  const { data: invoices } = await supabase
    .from('invoices')
    .select('customer_name')
    .ilike('customer_email', normalized)
    .limit(1);

  if (invoices && invoices.length > 0) {
    const name = invoices[0].customer_name || normalized;
    return res.json({ token: signPortalJWT(normalized, name), name });
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('customer_name')
    .ilike('customer_email', normalized)
    .limit(1);

  if (orders && orders.length > 0) {
    const name = orders[0].customer_name || normalized;
    return res.json({ token: signPortalJWT(normalized, name), name });
  }

  return res.status(404).json({ error: 'No account found for that email. Contact your NodeRoute representative.' });
});

// GET /api/portal/me
router.get('/me', authenticatePortalToken, (req, res) => {
  res.json({ email: req.customerEmail, name: req.customerName });
});

// GET /api/portal/orders
router.get('/orders', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_name, customer_address, items, status, notes, created_at, driver_name')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/portal/invoices
router.get('/invoices', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_name, customer_address, items, subtotal, tax, total, status, driver_name, created_at, signed_at, sent_at')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/portal/invoices/:id/pdf — scoped to the authenticated customer's email
router.get('/invoices/:id/pdf', authenticatePortalToken, async (req, res) => {
  const { data: inv, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', req.params.id)
    .ilike('customer_email', req.customerEmail)
    .single();
  if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });
  const pdfBuffer = await buildInvoicePDF(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_number || inv.id.slice(0, 8)}.pdf"`);
  res.send(pdfBuffer);
});

module.exports = router;
