const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();
const CUSTOMER_FIELDS = ['customer_number', 'company_name', 'phone_number', 'fax_number', 'contact_name', 'payment_terms', 'address'];

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function customerPayload(source) {
  const payload = {};
  CUSTOMER_FIELDS.forEach(field => {
    if (source[field] !== undefined) payload[field] = source[field] || null;
  });
  const taxValue = source.tax_enabled ?? source.taxEnabled;
  if (taxValue !== undefined) payload.tax_enabled = parseBoolean(taxValue);
  return payload;
}

// ── CUSTOMERS (Supabase: "Customers") ─────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('Customers').select('*').order('customer_number', { ascending: true }), res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { company_name } = req.body;
  if (!company_name) return res.status(400).json({ error: 'Company name required' });
  const insertResult = await insertRecordWithOptionalScope(supabase, 'Customers', customerPayload(req.body), req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('Customers').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const updateResult = await executeWithOptionalScope(
    (candidate) => supabase.from('Customers').update(candidate).eq('id', req.params.id).select().single(),
    customerPayload(req.body)
  );
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
  const data = updateResult.data;
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('Customers').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('Customers').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
