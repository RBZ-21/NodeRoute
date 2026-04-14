const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ── ORDERS ────────────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('orders').select('*').order('created_at', { ascending: false }), res);
  if (!data) return;
  res.json(data || []);
});

router.post('/', authenticateToken, async (req, res) => {
  const { customerName, customerEmail, customerAddress, items, notes } = req.body;
  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const data = await dbQuery(supabase.from('orders').insert([{
    order_number: orderNumber,
    customer_name: customerName,
    customer_email: customerEmail || null,
    customer_address: customerAddress || null,
    items: items || [],
    status: 'pending',
    notes: notes || null,
    driver_name: null,
    route_id: null
  }]).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, async (req, res) => {
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

router.delete('/:id', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('orders').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Order deleted' });
});

// Send order to processing (prints + marks in_process)
router.post('/:id/send', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('orders').update({ status: 'in_process' }).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

// Fulfill order: enter actual weights → generate invoice
router.post('/:id/fulfill', authenticateToken, async (req, res) => {
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
  await supabase.from('orders').update({ status: 'invoiced', driver_name: driverName || null, route_id: routeId || null }).eq('id', req.params.id);
  res.json({ invoice, message: 'Invoice created' });
});

module.exports = router;
