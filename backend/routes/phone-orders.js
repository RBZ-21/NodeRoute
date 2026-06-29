'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../lib/zod-validate');
const { scopeQueryByContext, filterRowsByContext } = require('../services/operating-context');
const { loadGuides } = require('./order-guides');
const { loadActiveMessages } = require('./customer-messages');
const logger = require('../services/logger');

const router = express.Router();

const PHONE_ORDER_STATUSES = new Set(['draft', 'confirmed', 'rejected']);
const phoneOrderPatchSchema = z.object({
  status: z.enum(['draft', 'confirmed', 'rejected']).optional(),
  needs_callback: z.boolean().optional(),
  items: z.array(z.any()).max(200).optional(),
  line_items: z.array(z.any()).max(200).optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'No valid fields to update',
});

router.use(authenticateToken, requireRole('admin', 'manager'));

function normalizeText(value) {
  return String(value ?? '').trim();
}

async function resolvePhoneOrderCustomerId(order, context) {
  const explicit = normalizeText(order?.customer_id || order?.customerId);
  if (explicit) return explicit;
  const customerName = normalizeText(order?.business_name || order?.customer_name);
  if (!customerName) return '';
  const { data, error } = await scopeQueryByContext(
    supabase.from('Customers').select('id, company_name'),
    context,
  )
    .eq('company_name', customerName)
    .limit(1);
  if (error) return '';
  return normalizeText(filterRowsByContext(data || [], context)[0]?.id);
}

async function enrichPhoneOrder(order, context) {
  const customerId = await resolvePhoneOrderCustomerId(order, context);
  if (!customerId) return { ...order, order_guides: [], hot_messages: [] };
  try {
    const [orderGuides, hotMessages] = await Promise.all([
      loadGuides(customerId, context, { activeOnly: true }),
      loadActiveMessages(customerId, 'order_entry', context),
    ]);
    return { ...order, customer_id: order.customer_id || customerId, order_guides: orderGuides, hot_messages: hotMessages };
  } catch (error) {
    logger.warn({ err: error.message, orderId: order.id }, 'Failed to enrich phone order workflow context');
    return { ...order, customer_id: order.customer_id || customerId, order_guides: [], hot_messages: [] };
  }
}

// GET /api/phone-orders — list phone-sourced orders for this company, newest first
router.get('/', async (req, res) => {
  const { data, error } = await scopeQueryByContext(
    supabase.from('orders').select('*'),
    req.context
  )
    .eq('source', 'phone')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ err: error.message }, 'Failed to fetch phone orders');
    return res.status(500).json({ error: 'Failed to fetch phone orders' });
  }

  const rows = filterRowsByContext(data || [], req.context);
  return res.json(await Promise.all(rows.map((order) => enrichPhoneOrder(order, req.context))));
});

// GET /api/phone-orders/draft-count — count of unreviewed (draft) phone orders
router.get('/draft-count', async (req, res) => {
  const { data, error } = await scopeQueryByContext(
    supabase.from('orders').select('id, company_id, location_id'),
    req.context
  )
    .eq('source', 'phone')
    .eq('status', 'draft');

  if (error) {
    logger.error({ err: error.message }, 'Failed to count draft phone orders');
    return res.status(500).json({ error: 'Failed to count orders' });
  }

  return res.json({ count: filterRowsByContext(data || [], req.context).length });
});

// PATCH /api/phone-orders/:id — update status or needs_callback
router.patch('/:id', validateBody(phoneOrderPatchSchema), async (req, res) => {
  const { id } = req.params;
  const updates = {};
  const body = req.validated.body;

  if ('status' in body) {
    if (!PHONE_ORDER_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    updates.status = body.status;
  }
  if ('needs_callback' in body) updates.needs_callback = body.needs_callback === true;
  if ('items' in body) updates.items = body.items || [];
  if ('line_items' in body) updates.line_items = body.line_items || [];

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { data, error } = await scopeQueryByContext(
    supabase.from('orders').update(updates),
    req.context
  )
    .eq('id', id)
    .eq('source', 'phone')
    .select()
    .single();

  if (error) {
    logger.error({ err: error.message, id }, 'Failed to update phone order');
    return res.status(500).json({ error: 'Failed to update order' });
  }
  if (!data) return res.status(404).json({ error: 'Phone order not found' });

  return res.json(await enrichPhoneOrder(data, req.context));
});

module.exports = router;
