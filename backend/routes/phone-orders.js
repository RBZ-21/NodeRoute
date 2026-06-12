'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { scopeQueryByContext, filterRowsByContext } = require('../services/operating-context');
const logger = require('../services/logger');

const router = express.Router();

const PHONE_ORDER_STATUSES = new Set(['draft', 'confirmed', 'rejected']);

router.use(authenticateToken, requireRole('admin', 'manager'));

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

  return res.json(filterRowsByContext(data || [], req.context));
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
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = {};

  if ('status' in req.body) {
    if (!PHONE_ORDER_STATUSES.has(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    updates.status = req.body.status;
  }
  if ('needs_callback' in req.body) updates.needs_callback = req.body.needs_callback === true;

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

  return res.json(data);
});

module.exports = router;
