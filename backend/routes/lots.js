const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/lots ─────────────────────────────────────────────────────────────
// List lot codes, optionally filtered by product_id.
// Used by frontend to populate lot-selection dropdowns.
router.get('/', authenticateToken, async (req, res) => {
  const { product_id, active_only } = req.query;

  let query = supabase
    .from('lot_codes')
    .select('id, lot_number, product_id, vendor_id, quantity_received, unit_of_measure, received_date, expiration_date, notes, created_at')
    .order('expiration_date', { ascending: true, nullsFirst: false });

  if (product_id) {
    query = query.eq('product_id', product_id);
  }

  // active_only=true filters out expired lots (past expiration_date)
  if (active_only === 'true') {
    const today = new Date().toISOString().slice(0, 10);
    query = query.or(`expiration_date.is.null,expiration_date.gte.${today}`);
  }

  const { data, error } = await query.limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/lots ─────────────────────────────────────────────────────────────
// Create a lot record manually (also called internally by PO confirm).
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { lot_number, product_id, vendor_id, quantity_received, unit_of_measure, received_date, expiration_date, notes } = req.body;

  if (!lot_number || !lot_number.trim()) {
    return res.status(400).json({ error: 'lot_number is required' });
  }

  const { data, error } = await supabase.from('lot_codes').insert([{
    lot_number:        lot_number.trim(), // stored exactly as entered
    product_id:        product_id || null,
    vendor_id:         vendor_id  || null,
    quantity_received: parseFloat(quantity_received) || 0,
    unit_of_measure:   unit_of_measure || 'lb',
    received_date:     received_date   || new Date().toISOString().slice(0, 10),
    received_by:       req.user?.name  || req.user?.email || null,
    expiration_date:   expiration_date || null,
    notes:             notes || null,
  }]).select().single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `Lot number "${lot_number.trim()}" already exists` });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// ── GET /api/lots/:lotNumber/trace ────────────────────────────────────────────
// FDA 24-hour traceability report for a single lot.
// Returns the full supply chain: receiving → orders → stops.
// Admin only. Must be fast — single DB query set.
router.get('/:lotNumber/trace', authenticateToken, requireRole('admin'), async (req, res) => {
  const lotNumber = req.params.lotNumber;

  // 1. Fetch the lot record
  const { data: lot, error: lotErr } = await supabase
    .from('lot_codes')
    .select('id, lot_number, product_id, vendor_id, quantity_received, unit_of_measure, received_date, received_by, expiration_date, notes, created_at')
    .eq('lot_number', lotNumber)
    .maybeSingle();

  if (lotErr) return res.status(500).json({ error: lotErr.message });
  if (!lot) return res.status(404).json({ error: `Lot "${lotNumber}" not found` });

  // 2. Find orders that contain this lot (JSONB containment — uses GIN index)
  const [ordersResult, stopsResult, productResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_email, customer_address, status, items, created_at')
      .contains('items', JSON.stringify([{ lot_number: lotNumber }])),

    supabase
      .from('stops')
      .select('id, name, address, notes, shipped_lots, created_at')
      .contains('shipped_lots', JSON.stringify([{ lot_number: lotNumber }])),

    lot.product_id
      ? supabase.from('seafood_inventory').select('item_number, description, category, unit').eq('item_number', lot.product_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (ordersResult.error) return res.status(500).json({ error: ordersResult.error.message });
  if (stopsResult.error)  return res.status(500).json({ error: stopsResult.error.message });

  // Extract per-order lot quantity from items JSONB
  const orders = (ordersResult.data || []).map((order) => {
    const lotItems = (order.items || []).filter(
      (it) => it.lot_number === lotNumber || String(it.lot_id) === String(lot.id)
    );
    const quantity = lotItems.reduce((sum, it) => {
      const q = parseFloat(it.quantity_from_lot ?? it.requested_weight ?? it.quantity ?? 0) || 0;
      return sum + q;
    }, 0);
    return {
      order_id:      order.id,
      order_number:  order.order_number,
      customer:      order.customer_name,
      customer_email: order.customer_email,
      status:        order.status,
      quantity,
      delivery_date: order.created_at,
    };
  });

  const stops = (stopsResult.data || []).map((stop) => {
    const lotEntry = (stop.shipped_lots || []).find((sl) => sl.lot_number === lotNumber);
    return {
      stop_id:      stop.id,
      stop_name:    stop.name,
      address:      stop.address,
      quantity:     lotEntry?.quantity ?? null,
      delivered_at: stop.created_at,
    };
  });

  res.json({
    lot: {
      lot_number:        lot.lot_number,
      product_id:        lot.product_id,
      product:           productResult.data?.description || lot.product_id || null,
      vendor:            lot.vendor_id,
      received_date:     lot.received_date,
      received_by:       lot.received_by,
      quantity_received: lot.quantity_received,
      unit_of_measure:   lot.unit_of_measure,
      expiration_date:   lot.expiration_date,
      notes:             lot.notes,
      created_at:        lot.created_at,
    },
    orders,
    stops,
  });
});

// ── GET /api/traceability/report ──────────────────────────────────────────────
// Paginated lot-movement report for admins.
// Query params: ?lot=, ?product_id=, ?date_from=, ?date_to=, ?page=, ?limit=
// Returns rows suitable for CSV export.
router.get('/traceability/report', authenticateToken, requireRole('admin'), async (req, res) => {
  const { lot, product_id, date_from, date_to, page = '1', limit: limitParam = '50' } = req.query;

  const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
  const pageSize = Math.min(200, parseInt(limitParam, 10) || 50);
  const offset   = (pageNum - 1) * pageSize;

  let query = supabase
    .from('lot_codes')
    .select('id, lot_number, product_id, vendor_id, quantity_received, unit_of_measure, received_date, received_by, expiration_date, notes, created_at', { count: 'exact' })
    .order('received_date', { ascending: false });

  if (lot)        query = query.ilike('lot_number', `%${lot}%`);
  if (product_id) query = query.eq('product_id', product_id);
  if (date_from)  query = query.gte('received_date', date_from);
  if (date_to)    query = query.lte('received_date', date_to);

  query = query.range(offset, offset + pageSize - 1);

  const { data: lots, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // For each lot, tally how much was shipped (sum across order items that reference it)
  const lotNumbers = (lots || []).map((l) => l.lot_number);

  let orderRows = [];
  if (lotNumbers.length) {
    // Query orders containing any of these lot numbers using JSONB path operator
    const { data: matchedOrders } = await supabase
      .from('orders')
      .select('id, order_number, items, status');

    // Filter in JS (Supabase doesn't support OR jsonb containment across array of values)
    orderRows = (matchedOrders || []).filter((o) =>
      (o.items || []).some((it) => lotNumbers.includes(it.lot_number))
    );
  }

  // Build qty_shipped map per lot_number
  const qtyShippedMap = {};
  for (const order of orderRows) {
    for (const item of (order.items || [])) {
      if (!item.lot_number || !lotNumbers.includes(item.lot_number)) continue;
      const qty = parseFloat(item.quantity_from_lot ?? item.requested_weight ?? item.quantity ?? 0) || 0;
      qtyShippedMap[item.lot_number] = (qtyShippedMap[item.lot_number] || 0) + qty;
    }
  }

  const rows = (lots || []).map((l) => {
    const qty_shipped   = parseFloat((qtyShippedMap[l.lot_number] || 0).toFixed(3));
    const qty_remaining = parseFloat(Math.max(0, l.quantity_received - qty_shipped).toFixed(3));
    return {
      lot_number:        l.lot_number,
      product_id:        l.product_id,
      vendor:            l.vendor_id,
      received_date:     l.received_date,
      received_by:       l.received_by,
      qty_received:      l.quantity_received,
      unit_of_measure:   l.unit_of_measure,
      qty_shipped,
      qty_remaining,
      expiration_date:   l.expiration_date,
      notes:             l.notes,
    };
  });

  res.json({
    page: pageNum,
    page_size: pageSize,
    total: count ?? rows.length,
    rows,
  });
});

// ── PATCH /api/lots/products/:itemNumber/ftl ──────────────────────────────────
// Toggle is_ftl_product flag on a seafood_inventory item.
// Admin only — determines whether lot assignment is required on orders.
router.patch('/products/:itemNumber/ftl', authenticateToken, requireRole('admin'), async (req, res) => {
  const { itemNumber } = req.params;
  const isFtl = req.body.is_ftl_product === true || req.body.is_ftl_product === 'true';

  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ is_ftl_product: isFtl })
    .eq('item_number', itemNumber)
    .select('item_number, description, is_ftl_product')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: `Product ${itemNumber} not found` });
  res.json(data);
});

module.exports = router;
