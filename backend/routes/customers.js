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
const CUSTOMER_FIELDS = [
  'customer_number',
  'company_name',
  'email',
  'status',
  'phone_number',
  'phone',
  'fax_number',
  'contact_name',
  'payment_terms',
  'address',
  'billing_name',
  'billing_contact',
  'billing_email',
  'billing_phone',
  'billing_address',
  'credit_hold_reason',
];

function normalizeLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(restaurant|rest|llc|inc|co|company)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreStopMatch(customerName, stopName) {
  const customerNorm = normalizeLookup(customerName);
  const stopNorm = normalizeLookup(stopName);
  if (!customerNorm || !stopNorm) return 0;
  if (customerNorm === stopNorm) return 3;
  if (customerNorm.includes(stopNorm) || stopNorm.includes(customerNorm)) return 2;
  const customerTokens = new Set(customerNorm.split(' ').filter(Boolean));
  const stopTokens = stopNorm.split(' ').filter(Boolean);
  const overlap = stopTokens.filter((token) => customerTokens.has(token)).length;
  return overlap >= Math.min(2, stopTokens.length) ? 1 : 0;
}

function enrichCustomersWithStopAddresses(customers, stops) {
  if (!Array.isArray(customers) || !Array.isArray(stops) || !stops.length) return customers;
  return customers.map((customer) => {
    if (customer?.address || customer?.billing_address) return customer;
    const match = (stops || [])
      .map((stop) => ({ stop, score: scoreStopMatch(customer?.company_name, stop?.name) }))
      .filter((entry) => entry.score > 0 && entry.stop?.address)
      .sort((a, b) => b.score - a.score)[0];
    if (!match) return customer;
    return {
      ...customer,
      address: customer.address || match.stop.address || null,
      billing_address: customer.billing_address || match.stop.address || null,
    };
  });
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function customerPayload(source) {
  const payload = {};
  CUSTOMER_FIELDS.forEach(field => {
    if (source[field] !== undefined) payload[field] = source[field] || null;
  });
  if (source.phone !== undefined && source.phone_number === undefined) payload.phone_number = source.phone || null;
  const taxValue = source.tax_enabled ?? source.taxEnabled;
  if (taxValue !== undefined) payload.tax_enabled = parseBoolean(taxValue);
  const holdValue = source.credit_hold ?? source.creditHold;
  if (holdValue !== undefined) payload.credit_hold = parseBoolean(holdValue);
  return payload;
}

async function fetchAllCustomers(res) {
  const pageSize = 1000;
  const rows = [];
  let nextId = 0;

  while (true) {
    const page = await dbQuery(
      supabase
        .from('Customers')
        .select('*')
        .order('id', { ascending: true })
        .gte('id', nextId)
        .limit(pageSize),
      res
    );
    if (!page) return null;
    if (!page.length) break;

    rows.push(...page);

    const lastId = Number(page[page.length - 1]?.id);
    if (!Number.isFinite(lastId)) break;
    if (page.length < pageSize) break;

    nextId = lastId + 1;
  }

  return rows.sort((a, b) => {
    const av = a?.customer_number;
    const bv = b?.customer_number;
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return String(av).localeCompare(String(bv));
  });
}

// ── CUSTOMERS (Supabase: "Customers") ─────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await fetchAllCustomers(res);
  if (!data) return;
  const scopedCustomers = filterRowsByContext(data, req.context);
  const stopsResult = await supabase.from('stops').select('name,address');
  const scopedStops = stopsResult.error ? [] : filterRowsByContext(stopsResult.data || [], req.context);
  res.json(enrichCustomersWithStopAddresses(scopedCustomers, scopedStops));
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

// ── CREDIT HOLD ────────────────────────────────────────────────────────────────

// Place a customer on credit hold
router.post('/:id/hold', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('Customers').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const reason = req.body?.reason ? String(req.body.reason).trim() : null;
  const updateResult = await executeWithOptionalScope(
    (candidate) => supabase.from('Customers').update(candidate).eq('id', req.params.id).select().single(),
    {
      credit_hold: true,
      credit_hold_reason: reason,
      credit_hold_placed_at: new Date().toISOString(),
    }
  );
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
  res.json(updateResult.data);
});

// Lift a customer's credit hold
router.delete('/:id/hold', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('Customers').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const updateResult = await executeWithOptionalScope(
    (candidate) => supabase.from('Customers').update(candidate).eq('id', req.params.id).select().single(),
    {
      credit_hold: false,
      credit_hold_reason: null,
      credit_hold_placed_at: null,
    }
  );
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
  res.json(updateResult.data);
});

module.exports = router;
