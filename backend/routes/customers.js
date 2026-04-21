const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── CUSTOMERS (Supabase: "Customers") ─────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('Customers').select('*').order('customer_number', { ascending: true }), res);
  if (!data) return;
  res.json(data);
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { customer_number, company_name, phone_number, fax_number, contact_name, payment_terms } = req.body;
  if (!company_name) return res.status(400).json({ error: 'Company name required' });
  const data = await dbQuery(supabase.from('Customers').insert([{ customer_number: customer_number||null, company_name, phone_number: phone_number||null, fax_number: fax_number||null, contact_name: contact_name||null, payment_terms: payment_terms||null }]).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('Customers').update(req.body).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('Customers').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
