const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { loadCompanySettings } = require('../services/company-settings');
const { createMailer } = require('../services/email');
const {
  buildLotNoticeEmail,
  groupLotNoticeRecipients,
} = require('../services/lot-traceability-notice');
const { validateBody } = require('../lib/zod-validate');
const { lotCreateBodySchema, lotFtlPatchBodySchema } = require('../lib/lots-schemas');
const { buildScopeFields, scopeQueryByContext } = require('../services/operating-context');

const router = express.Router();

async function loadLotTraceData(lotNumber, context = null) {
  const { data: lotRows, error: lotErr } = await scopeQueryByContext(supabase
    .from('lot_codes'), context)
    .select('id, lot_number, product_id, vendor_id, quantity_received, unit_of_measure, received_date, received_by, expiration_date, notes, created_at')
    .eq('lot_number', lotNumber)
    .limit(1);
  const lot = lotRows?.[0] || null;

  if (lotErr) {
    return { status: 500, error: lotErr.message };
  }
  if (!lot) {
    return { status: 404, error: `Lot "${lotNumber}" not found` };
  }

  const [ordersResult, stopsResult, productResult] = await Promise.all([
    scopeQueryByContext(supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_email, customer_address, status, items, created_at, company_id, location_id'), context)
      .contains('items', JSON.stringify([{ lot_number: lotNumber }])),

    scopeQueryByContext(supabase
      .from('stops')
      .select('id, name, address, notes, shipped_lots, created_at, company_id, location_id'), context)
      .contains('shipped_lots', JSON.stringify([{ lot_number: lotNumber }])),

    lot.product_id
      ? scopeQueryByContext(supabase.from('products').select('item_number, description, category, unit'), context).eq('item_number', lot.product_id).limit(1)
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (ordersResult.error) return { status: 500, error: ordersResult.error.message };
  if (stopsResult.error) return { status: 500, error: stopsResult.error.message };
  if (productResult.error) return { status: 500, error: productResult.error.message };
  const product = productResult.data?.[0] || null;

  const orders = (ordersResult.data || []).map((order) => {
    const lotItems = (order.items || []).filter(
      (it) => it.lot_number === lotNumber || String(it.lot_id) === String(lot.id)
    );
    const quantity = lotItems.reduce((sum, it) => {
      const qty = parseFloat(it.quantity_from_lot ?? it.requested_weight ?? it.quantity ?? 0) || 0;
      return sum + qty;
    }, 0);
    return {
      order_id: order.id,
      order_number: order.order_number,
      customer: order.customer_name,
      customer_email: order.customer_email,
      status: order.status,
      quantity,
      delivery_date: order.created_at,
    };
  });

  const stops = (stopsResult.data || []).map((stop) => {
    const lotEntry = (stop.shipped_lots || []).find((sl) => sl.lot_number === lotNumber);
    return {
      stop_id: stop.id,
      stop_name: stop.name,
      address: stop.address,
      quantity: lotEntry?.quantity ?? null,
      delivered_at: stop.created_at,
    };
  });

  return {
    status: 200,
    data: {
      lot: {
        lot_number: lot.lot_number,
        product_id: lot.product_id,
        product: product?.description || lot.product_id || null,
        vendor: lot.vendor_id,
        received_date: lot.received_date,
        received_by: lot.received_by,
        quantity_received: lot.quantity_received,
        unit_of_measure: lot.unit_of_measure,
        expiration_date: lot.expiration_date,
        notes: lot.notes,
        created_at: lot.created_at,
      },
      orders,
      stops,
    },
  };
}

// ── GET /api/lots ─────────────────────────────────────────────────────────────
// List lot codes, optionally filtered by product_id.
// Used by frontend to populate lot-selection dropdowns.
router.get('/', authenticateToken, async (req, res) => {
  const { product_id, active_only } = req.query;

  let query = scopeQueryByContext(supabase
    .from('lot_codes'), req.context)
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
router.post('/', authenticateToken, requireRole('admin', 'manager'), validateBody(lotCreateBodySchema), async (req, res) => {
  const { lot_number, product_id, vendor_id, quantity_received, unit_of_measure, received_date, expiration_date, notes } = req.validated.body;

  const { data, error } = await supabase.from('lot_codes').insert([{
    lot_number,
    product_id:        product_id        || null,
    vendor_id:         vendor_id         || null,
    quantity_received: quantity_received ?? 0,
    unit_of_measure:   unit_of_measure   || 'lb',
    received_date:     received_date     || new Date().toISOString().slice(0, 10),
    received_by:       req.user?.name    || req.user?.email || null,
    expiration_date:   expiration_date   || null,
    notes:             notes             || null,
    ...buildScopeFields(req.context),
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
  const traceData = await loadLotTraceData(lotNumber, req.context);
  if (traceData.error) return res.status(traceData.status).json({ error: traceData.error });
  res.json(traceData.data);
});

// ── GET /api/traceability/report ──────────────────────────────────────────────
// Paginated lot-movement report for admins.
// Query params: ?lot=, ?product_id=, ?vendor=, ?date_from=, ?date_to=, ?page=, ?limit=
// Returns rows suitable for CSV export.
router.get('/traceability/report', authenticateToken, requireRole('admin'), async (req, res) => {
  const { lot, product_id, vendor, date_from, date_to, page = '1', limit: limitParam = '50' } = req.query;

  const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
  const pageSize = Math.min(200, parseInt(limitParam, 10) || 50);
  const offset   = (pageNum - 1) * pageSize;

  let query = scopeQueryByContext(supabase
    .from('lot_codes'), req.context)
    .select('id, lot_number, product_id, vendor_id, quantity_received, unit_of_measure, received_date, received_by, expiration_date, notes, created_at', { count: 'exact' })
    .order('received_date', { ascending: false });

  if (lot)        query = query.ilike('lot_number', `%${lot}%`);
  if (product_id) query = query.eq('product_id', product_id);
  if (vendor)     query = query.ilike('vendor_id', `%${vendor}%`);
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
    const { data: matchedOrders } = await scopeQueryByContext(supabase
      .from('orders')
      .select('id, order_number, items, status, company_id, location_id'), req.context);

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

// ── POST /api/lots/:lotNumber/notice ─────────────────────────────────────────
// Sends a standalone traceability notice to customers linked to the lot.
router.post('/:lotNumber/notice', authenticateToken, requireRole('admin'), async (req, res) => {
  const lotNumber = req.params.lotNumber;
  const mailer = createMailer();
  if (!mailer) return res.status(503).json({ error: 'Email not configured on server' });

  const traceData = await loadLotTraceData(lotNumber, req.context);
  if (traceData.error) return res.status(traceData.status).json({ error: traceData.error });

  const recipients = groupLotNoticeRecipients(traceData.data.orders);
  if (!recipients.length) {
    return res.status(422).json({ error: 'No customer email addresses were found for this lot' });
  }

  const settings = await loadCompanySettings(
    req.context?.activeCompanyId || req.context?.companyId,
    req.context?.companyName || 'NodeRoute Systems',
  );

  for (const recipientGroup of recipients) {
    const email = buildLotNoticeEmail({
      businessName: settings.businessName,
      lot: traceData.data.lot,
      customerName: recipientGroup.customerName,
      orders: recipientGroup.orders,
    });
    await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to: recipientGroup.recipient,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }

  res.json({
    sent: true,
    lot_number: traceData.data.lot.lot_number,
    recipient_count: recipients.length,
    order_count: traceData.data.orders.length,
  });
});

// ── PATCH /api/lots/products/:itemNumber/ftl ──────────────────────────────────
// Toggle is_ftl_regulated flag on a products item.
// Admin only — determines whether lot assignment is required on orders.
router.patch('/products/:itemNumber/ftl', authenticateToken, requireRole('admin'), validateBody(lotFtlPatchBodySchema), async (req, res) => {
  const { itemNumber } = req.params;
  const isFtl = req.validated.body.is_ftl_product;

  const { data, error } = await supabase
    .from('products')
    .update({ is_ftl_regulated: isFtl })
    .eq('item_number', itemNumber)
    .select('item_number, description, is_ftl_regulated')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: `Product ${itemNumber} not found` });
  res.json(data);
});

module.exports = router;
