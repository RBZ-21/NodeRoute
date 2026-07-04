const express = require('express');
const { z } = require('zod');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { supabase } = require('../services/supabase');
const { filterRowsByContext, scopeQueryByContext } = require('../services/operating-context');
const { renderOrderSlip } = require('../services/print-template');
const { validateParams } = require('../lib/zod-validate');
const { buildOrderDocumentPDF } = require('../services/order-documents');
const { escapeHtml } = require('../lib/html');

const router = express.Router();
const documentRole = requireRole('admin', 'manager', 'driver');
const orderParamSchema = z.object({ orderId: z.string().trim().min(1).max(120) });
const routeParamSchema = z.object({ routeId: z.string().trim().min(1).max(120) });

async function loadOrder(orderId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('orders').select('*'),
    context,
  )
    .eq('id', orderId)
    .limit(1);
  if (error) throw error;
  return filterRowsByContext(data || [], context)[0] || null;
}

async function loadRoute(routeId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('routes').select('*'),
    context,
  )
    .eq('id', routeId)
    .limit(1);
  if (error) throw error;
  return filterRowsByContext(data || [], context)[0] || null;
}

async function loadRouteStops(routeId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('stops').select('*'),
    context,
  )
    .eq('route_id', routeId)
    .order('sequence', { ascending: true });
  if (error) throw error;
  return filterRowsByContext(data || [], context);
}

async function loadRouteOrders(routeId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('orders').select('*'),
    context,
  )
    .eq('route_id', routeId);
  if (error) throw error;
  return filterRowsByContext(data || [], context);
}

function sendPdf(res, filename, pdf) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(pdf);
}

async function routeDocument(req, res, title) {
  const route = await loadRoute(req.validated.params.routeId, req.context);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  const [stops, orders] = await Promise.all([
    loadRouteStops(route.id, req.context),
    loadRouteOrders(route.id, req.context),
  ]);
  const pdf = await buildOrderDocumentPDF({ title, route, stops, orders });
  return sendPdf(res, `${title.toLowerCase().replace(/\s+/g, '-')}-${route.id}.pdf`, pdf);
}

async function orderDocument(req, res, title) {
  const order = await loadOrder(req.validated.params.orderId, req.context);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const pdf = await buildOrderDocumentPDF({ title, order });
  return sendPdf(res, `${title.toLowerCase().replace(/\s+/g, '-')}-${order.id}.pdf`, pdf);
}

// Minimal template route: render an order slip for a given order id
router.get('/order-slip/:orderId', authenticateToken, documentRole, validateParams(orderParamSchema), async (req, res) => {
  const data = await loadOrder(req.validated.params.orderId, req.context);
  if (!data) return res.status(404).json({ error: 'Order not found' });
  const html = `<pre>${escapeHtml(renderOrderSlip({ ...data, items: data.items || [] }))}</pre>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

router.get('/loading-sheet/:routeId', authenticateToken, documentRole, validateParams(routeParamSchema), async (req, res) => {
  await routeDocument(req, res, 'LOADING SHEET');
});

router.get('/cut-list/:orderId', authenticateToken, documentRole, validateParams(orderParamSchema), async (req, res) => {
  await orderDocument(req, res, 'CUT LIST');
});

router.get('/pick-list/:orderId', authenticateToken, documentRole, validateParams(orderParamSchema), async (req, res) => {
  await orderDocument(req, res, 'PICK LIST');
});

router.get('/pull-sheet/:routeId', authenticateToken, documentRole, validateParams(routeParamSchema), async (req, res) => {
  await routeDocument(req, res, 'PULL SHEET');
});

router.get('/picking-labels/:orderId', authenticateToken, documentRole, validateParams(orderParamSchema), async (req, res) => {
  await orderDocument(req, res, 'PICKING LABELS');
});

module.exports = router;
