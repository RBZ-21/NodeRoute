const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const config = require('../lib/config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');
const creditEngine = require('../services/creditEngine');

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
  'delivery_notes',
  'preferred_delivery_window',
  'preferred_door',
  'default_route_id',
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

// ── ADDRESS LOOKUP via Google Places ──────────────────────────────────────────
// GET /api/customers/address-lookup?name=<business+name>
// Returns { address } or { error }
router.get('/address-lookup', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name query param is required' });

  const apiKey = config.GOOGLE_MAPS_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GOOGLE_MAPS_KEY is not configured on the server' });

  try {
    // Step 1: Find the place ID
    const findUrl = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
    findUrl.searchParams.set('input', name);
    findUrl.searchParams.set('inputtype', 'textquery');
    findUrl.searchParams.set('fields', 'place_id,name,formatted_address');
    findUrl.searchParams.set('key', apiKey);

    const findResp = await fetch(findUrl.toString());
    if (!findResp.ok) throw new Error(`Google Places findplace HTTP ${findResp.status}`);
    const findData = await findResp.json();

    if (!findData.candidates || !findData.candidates.length) {
      return res.status(404).json({ error: `No results found for "${name}"` });
    }

    const candidate = findData.candidates[0];

    // If formatted_address came back in the findplace response, use it directly
    if (candidate.formatted_address) {
      return res.json({
        address: candidate.formatted_address,
        place_name: candidate.name || name,
        place_id: candidate.place_id,
      });
    }

    // Step 2: Get full place details for the address
    const detailUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    detailUrl.searchParams.set('place_id', candidate.place_id);
    detailUrl.searchParams.set('fields', 'formatted_address,name');
    detailUrl.searchParams.set('key', apiKey);

    const detailResp = await fetch(detailUrl.toString());
    if (!detailResp.ok) throw new Error(`Google Places details HTTP ${detailResp.status}`);
    const detailData = await detailResp.json();

    const address = detailData?.result?.formatted_address;
    if (!address) return res.status(404).json({ error: `Could not resolve address for "${name}"` });

    return res.json({
      address,
      place_name: detailData?.result?.name || name,
      place_id: candidate.place_id,
    });
  } catch (err) {
    console.error('[address-lookup]', err);
    return res.status(500).json({ error: 'Address lookup failed', detail: err.message });
  }
});

// ── CUSTOMERS (Supabase: "Customers") ─────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await fetchAllCustomers(res);
  if (!data) return;
  const scopedCustomers = filterRowsByContext(data, req.context);
  const stopsResult = await scopeQueryByContext(supabase.from('stops').select('name,address,company_id,location_id'), req.context);
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
  const existing = await dbQuery(scopeQueryByContext(supabase.from('Customers').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const updateResult = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(supabase.from('Customers').update(candidate), req.context).eq('id', req.params.id).select().single(),
    customerPayload(req.body)
  );
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
  const data = updateResult.data;
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(scopeQueryByContext(supabase.from('Customers').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(scopeQueryByContext(supabase.from('Customers').delete(), req.context).eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

// ── CREDIT HOLD ────────────────────────────────────────────────────────────────

// Legacy endpoints — kept for backward compatibility with existing UIs.
// Both paths now flow through the credit engine so every hold lands in the
// credit_hold_log audit trail. New code should call /api/credit/customer/:id/hold.
const VALID_HOLD_REASONS_LEGACY = ['over_limit', 'past_due', 'manual', 'new_account', 'bounced_check', 'disputed_invoice'];

router.post('/:id/hold', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(scopeQueryByContext(supabase.from('Customers').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const rawReason = req.body?.reason ? String(req.body.reason).trim().toLowerCase() : 'manual';
  const reason = VALID_HOLD_REASONS_LEGACY.includes(rawReason) ? rawReason : 'manual';
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;

  try {
    const updated = await creditEngine.applyHold(existing.id, reason, req.user.id, notes, 'manager_manual', req.context);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/hold', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(scopeQueryByContext(supabase.from('Customers').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const notes = req.body?.notes ? String(req.body.notes).trim() : 'Released via legacy endpoint';
  try {
    const updated = await creditEngine.releaseHold(existing.id, req.user.id, notes, 'manager_manual', req.context);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
