const express = require('express');
const crypto = require('crypto');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

function generateTrackingToken() {
  return crypto.randomBytes(18).toString('hex');
}

function trackingExpiry(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildTrackingUrl(req, token) {
  const fallbackBase = `${req.protocol}://${req.get('host')}`;
  const baseUrl = (process.env.BASE_URL || fallbackBase).replace(/\/$/, '');
  return `${baseUrl}/track?t=${encodeURIComponent(token)}`;
}

// ── ORDERS ────────────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('orders').select('*').order('created_at', { ascending: false }), res);
  if (!data) return;
  res.json(filterRowsByContext(data || [], req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { customerName, customerEmail, customerAddress, items, notes } = req.body;
  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const trackingToken = generateTrackingToken();
  const insertResult = await insertRecordWithOptionalScope(supabase, 'orders', {
    order_number: orderNumber,
    customer_name: customerName,
    customer_email: customerEmail || null,
    customer_address: customerAddress || null,
    items: items || [],
    status: 'pending',
    notes: notes || null,
    driver_name: null,
    route_id: null,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiry(),
  }, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return;
  res.json({
    ...data,
    tracking_url: data.tracking_token ? buildTrackingUrl(req, data.tracking_token) : null,
  });
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const updates = {};
  if (req.body.customerName !== undefined) updates.customer_name = req.body.customerName;
  if (req.body.items !== undefined) updates.items = req.body.items;
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.driverName !== undefined) updates.driver_name = req.body.driverName;
  if (req.body.routeId !== undefined) updates.route_id = req.body.routeId;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  const data = await dbQuery(supabase.from('orders').update(updates).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('orders').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Order deleted' });
});

// Send order to processing (prints + marks in_process)
router.post('/:id/send', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('orders').update({ status: 'in_process' }).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

// Fulfill order: enter actual weights → generate invoice
router.post('/:id/fulfill', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { items, driverName, routeId } = req.body;
  const order = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!order) return;
  const invoiceItems = items.map(it => {
    const qty = it.unit === 'lb' ? (it.actual_weight || it.requested_weight || 0) : (it.requested_qty || 0);
    return { description: it.name, quantity: qty, unit: it.unit, unit_price: it.unit_price, total: parseFloat((qty * it.unit_price).toFixed(2)) };
  });
  const subtotal = invoiceItems.reduce((s, i) => s + i.total, 0);
  const tax = parseFloat((subtotal * 0.09).toFixed(2));
  const total = parseFloat((subtotal + tax).toFixed(2));
  const invoiceNumber = 'INV-' + Date.now().toString().slice(-6);
  const invoice = await dbQuery(supabase.from('invoices').insert([{
    invoice_number: invoiceNumber,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_address: order.customer_address,
    items: invoiceItems,
    subtotal, tax, total,
    driver_name: driverName || null,
    status: 'pending',
    notes: order.notes || null
  }]).select().single(), res);
  if (!invoice) return;
  const trackingToken = order.tracking_token || generateTrackingToken();
  const trackingExpiresAt = order.tracking_expires_at || trackingExpiry();
  await supabase.from('orders').update({
    status: 'invoiced',
    driver_name: driverName || null,
    route_id: routeId || null,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
  }).eq('id', req.params.id);
  res.json({
    invoice,
    message: 'Invoice created',
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
    tracking_url: buildTrackingUrl(req, trackingToken),
  });
});

router.post('/:id/tracking-link', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const order = await dbQuery(
    supabase
      .from('orders')
      .select('id, order_number, tracking_token, tracking_expires_at')
      .eq('id', req.params.id)
      .single(),
    res
  );
  if (!order) return;

  const shouldRegenerate =
    !!req.body?.regenerate ||
    !order.tracking_token ||
    !order.tracking_expires_at ||
    new Date(order.tracking_expires_at).getTime() <= Date.now();

  let trackingToken = order.tracking_token;
  let trackingExpiresAt = order.tracking_expires_at;

  if (shouldRegenerate) {
    trackingToken = generateTrackingToken();
    trackingExpiresAt = trackingExpiry();
    const updated = await dbQuery(
      supabase
        .from('orders')
        .update({
          tracking_token: trackingToken,
          tracking_expires_at: trackingExpiresAt,
        })
        .eq('id', req.params.id)
        .select('id, order_number, tracking_token, tracking_expires_at')
        .single(),
      res
    );
    if (!updated) return;
    trackingToken = updated.tracking_token;
    trackingExpiresAt = updated.tracking_expires_at;
  }

  res.json({
    orderId: order.id,
    orderNumber: order.order_number,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
    tracking_url: buildTrackingUrl(req, trackingToken),
  });
});

module.exports = router;
