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
const mapsRouter = require('./maps');

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
  const smsValue = source.sms_notifications_enabled ?? source.smsNotificationsEnabled;
  if (smsValue !== undefined) payload.sms_notifications_enabled = parseBoolean(smsValue);
  return payload;
}

async function fetchAllCustomers(res) {
  const pageSize = 1000;
  const rows = [];
  // BE-007: keyset pagination on the raw id value. The previous
  // nextId=0 / .gte / Number(id)+1 pattern assumed numeric ids and silently
  // truncated to one page whenever ids were not numeric.
  let cursor = null;

  while (true) {
    let query = supabase
      .from('Customers')
      .select('*')
      .order('id', { ascending: true })
      .limit(pageSize);
    if (cursor != null) query = query.gt('id', cursor);

    const page = await dbQuery(query, res);
    if (!page) return null;
    if (!page.length) break;

    rows.push(...page);
    if (page.length < pageSize) break;

    cursor = page[page.length - 1]?.id;
    if (cursor == null) break;
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

// ── CUSTOMER ORDER INSIGHTS helpers ───────────────────────────────────────────
// Shared by GET /:id/orders and GET /:id/frequently-ordered below. Mirrors the
// inline load-verify-or-respond pattern already duplicated across the
// PATCH/DELETE/hold handlers above, just extracted once for the two new routes
// so we don't add a fifth/sixth copy of it.
async function loadCustomerOrRespond(req, res) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('Customers').select('*'),
    req.context,
  )
    .eq('id', req.params.id)
    .limit(1);
  if (error) {
    res.status(500).json({ error: error.message });
    return null;
  }
  const existing = filterRowsByContext(data || [], req.context)[0] || null;
  if (!existing) {
    res.status(404).json({ error: 'Customer not found' });
    return null;
  }
  if (!rowMatchesContext(existing, req.context)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return existing;
}

const CUSTOMER_ORDER_PAGE_SIZE = 100;

async function fetchAllCustomerOrders(res, customerId, context, { fields = '*', windowStartIso = null } = {}) {
  const rows = [];
  let cursor = null;

  while (true) {
    let query = scopeQueryByContext(supabase.from('orders').select(fields), context)
      .eq('customer_id', customerId)
      .order('id', { ascending: true })
      .limit(CUSTOMER_ORDER_PAGE_SIZE);
    if (windowStartIso) query = query.gte('created_at', windowStartIso);
    if (cursor != null) query = query.gt('id', cursor);

    const page = await dbQuery(query, res);
    if (!page) return null;
    if (!page.length) break;

    rows.push(...filterRowsByContext(page, context));
    if (page.length < CUSTOMER_ORDER_PAGE_SIZE) break;

    cursor = page[page.length - 1]?.id;
    if (cursor == null) break;
  }

  return rows;
}

const FREQUENTLY_ORDERED_WINDOW_DAYS = 90;
// Orders in these statuses are never "active business" — everything else
// (pending, in_process, processed, delivered, invoiced, and any future status)
// counts. See backend/routes/sales-reps.js and pages/orders.types.ts for the
// real status values this repo writes; `rejected`/`draft` belong to the
// phone-orders staging table, not orders.status, but are excluded defensively
// since a caller could still hand us that value.
const FREQUENTLY_ORDERED_EXCLUDED_STATUSES = new Set(['cancelled', 'rejected', 'draft']);

function normalizeKeyPart(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Stable product identity when available; otherwise the normalized item
// number, then normalized description as a safe fallback (per product spec).
function frequentlyOrderedLineKey(item) {
  const productId = normalizeKeyPart(item?.product_id);
  if (productId) return `pid:${productId}`;
  const itemNumber = normalizeKeyPart(item?.item_number);
  if (itemNumber) return `item:${itemNumber}`;
  return `desc:${normalizeKeyPart(item?.description || item?.name)}`;
}

// orders.items line objects use different quantity fields depending on
// whether the item is catch-weight/lb-priced (see backend/migrations/add_lot_to_order_items.sql
// and frontend-v2/src/pages/orders.types.ts's orderItemQty helper for the
// canonical set). Frequently-ordered ranking only needs a reasonable
// non-negative quantity, not FSMA-grade weight precision.
function frequentlyOrderedItemQuantity(item) {
  const candidates = [item?.quantity, item?.requested_qty, item?.actual_weight, item?.requested_weight, item?.estimated_weight];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
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

router.get('/:id/location', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const location = await mapsRouter.resolveCustomerLocation(req.params.id, req.context);
    res.json(location);
  } catch (err) {
    const status = Number(err?.status) || 500;
    res.status(status).json({ error: err.message || 'Failed to load customer location', code: err.code });
  }
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { company_name } = req.body;
  if (!company_name) return res.status(400).json({ error: 'Company name required' });
  const insertResult = await insertRecordWithOptionalScope(supabase, 'Customers', customerPayload(req.body), req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return res.status(500).json({ error: 'Failed to create customer record' });
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
  if (!data) return res.status(500).json({ error: 'Failed to update customer record' });
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

// ── CUSTOMER ORDER INSIGHTS ────────────────────────────────────────────────────
// A more accessible entry point for a single customer's order history from the
// standard Customers page. This is additive: it does not touch or replace the
// Sales Rep Hub's own GET /api/sales-reps/order-history/:customerId route.
router.get('/:id/orders', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const customer = await loadCustomerOrRespond(req, res);
  if (!customer) return;

  const orders = await fetchAllCustomerOrders(res, customer.id, req.context);
  if (!orders) return;
  orders.sort((a, b) => {
    const timeDifference = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    return timeDifference || String(a.id || '').localeCompare(String(b.id || ''));
  });
  res.json(orders);
});

// Customer-specific "frequently ordered" items, aggregated server-side from
// that customer's own order history over a trailing 90-day window (from the
// order-guide UI, not manually-configured Order Guides). Kept on the server so
// the 90-day rule and the ranking are consistent and testable.
router.get('/:id/frequently-ordered', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const customer = await loadCustomerOrRespond(req, res);
  if (!customer) return;

  const windowStartIso = new Date(Date.now() - FREQUENTLY_ORDERED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const orders = await fetchAllCustomerOrders(res, customer.id, req.context, {
    fields: 'id,items,status,created_at,company_id,location_id',
    windowStartIso,
  });
  if (!orders) return;

  const qualifyingOrders = orders.filter(
    (order) => !FREQUENTLY_ORDERED_EXCLUDED_STATUSES.has(String(order?.status || '').toLowerCase())
  );

  const aggregated = new Map();
  for (const order of qualifyingOrders) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const seenKeysInThisOrder = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const key = frequentlyOrderedLineKey(item);

      let entry = aggregated.get(key);
      if (!entry) {
        entry = {
          product_id: item.product_id || null,
          item_number: item.item_number || null,
          description: item.description || item.name || 'Unknown item',
          order_count: 0,
          total_quantity: 0,
          last_ordered_at: null,
        };
        aggregated.set(key, entry);
      }
      if (!entry.product_id && item.product_id) entry.product_id = item.product_id;
      if (!entry.item_number && item.item_number) entry.item_number = item.item_number;

      entry.total_quantity += frequentlyOrderedItemQuantity(item);
      if (!seenKeysInThisOrder.has(key)) {
        entry.order_count += 1;
        seenKeysInThisOrder.add(key);
      }
      if (order.created_at && (!entry.last_ordered_at || new Date(order.created_at) > new Date(entry.last_ordered_at))) {
        entry.last_ordered_at = order.created_at;
      }
    }
  }

  // Rank by: distinct order count desc, total quantity desc, most recent
  // order date desc, then name asc for deterministic ties (per product spec).
  const items = Array.from(aggregated.values()).sort((a, b) => {
    if (b.order_count !== a.order_count) return b.order_count - a.order_count;
    if (b.total_quantity !== a.total_quantity) return b.total_quantity - a.total_quantity;
    const aTime = a.last_ordered_at ? new Date(a.last_ordered_at).getTime() : 0;
    const bTime = b.last_ordered_at ? new Date(b.last_ordered_at).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a.description).localeCompare(String(b.description));
  });

  res.json({ items, window_start: windowStartIso });
});

module.exports = router;
