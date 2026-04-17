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

// GET /api/portal/contact — return contact info from portal_contacts or most recent invoice
router.get('/contact', authenticatePortalToken, async (req, res) => {
  const { data: saved } = await supabase
    .from('portal_contacts')
    .select('email, name, phone, address, company, door_code, updated_at')
    .eq('email', req.customerEmail)
    .single();

  if (saved) return res.json(saved);

  // Fall back to most recent invoice data
  const { data: inv } = await supabase
    .from('invoices')
    .select('customer_name, customer_address')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false })
    .limit(1);

  res.json({
    email: req.customerEmail,
    name: (inv && inv[0]) ? inv[0].customer_name : req.customerName,
    address: (inv && inv[0]) ? inv[0].customer_address : null,
    phone: null,
    company: null,
  });
});

// PATCH /api/portal/contact — upsert contact info into portal_contacts
router.patch('/contact', authenticatePortalToken, async (req, res) => {
  const { name, phone, address, company } = req.body;
  const { error } = await supabase
    .from('portal_contacts')
    .upsert([{
      email: req.customerEmail,
      name: name || req.customerName,
      phone: phone || null,
      address: address || null,
      company: company || null,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'email' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Contact information saved' });
});

// PATCH /api/portal/doorcode — customer saves their door/access code
router.patch('/doorcode', authenticatePortalToken, async (req, res) => {
  const { door_code } = req.body;
  const code = (door_code || '').trim() || null;

  // Update portal_contacts — preserve existing fields
  const { data: existing } = await supabase
    .from('portal_contacts')
    .select('*')
    .eq('email', req.customerEmail)
    .single();

  if (existing) {
    await supabase
      .from('portal_contacts')
      .update({ door_code: code, updated_at: new Date().toISOString() })
      .eq('email', req.customerEmail);
  } else {
    await supabase
      .from('portal_contacts')
      .insert([{ email: req.customerEmail, name: req.customerName, door_code: code, updated_at: new Date().toISOString() }]);
  }

  // Best-effort: sync to matching stop row by name
  const lookupName = (existing && existing.name) || req.customerName;
  if (lookupName) {
    await supabase
      .from('stops')
      .update({ door_code: code })
      .ilike('name', lookupName);
  }

  res.json({ message: 'Door code saved' });
});

// GET /api/portal/inventory — in-stock seafood items, newest first
router.get('/inventory', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('seafood_inventory')
    .select('description, category, unit, on_hand_qty, on_hand_weight, cost, updated_at, created_at')
    .gt('on_hand_qty', 0)
    .order('updated_at', { ascending: false, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
