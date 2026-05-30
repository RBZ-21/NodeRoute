'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();

router.use(authenticateToken);

// GET /api/phone-orders — list all phone-sourced orders, newest first
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('source', 'phone')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ err: error.message }, 'Failed to fetch phone orders');
    return res.status(500).json({ error: 'Failed to fetch phone orders' });
  }

  return res.json(data || []);
});

// GET /api/phone-orders/draft-count — count of unreviewed (draft) phone orders
router.get('/draft-count', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('source', 'phone')
    .eq('status', 'draft');

  if (error) {
    logger.error({ err: error.message }, 'Failed to count draft phone orders');
    return res.status(500).json({ error: 'Failed to count orders' });
  }

  return res.json({ count: Array.isArray(data) ? data.length : 0 });
});

// PATCH /api/phone-orders/:id — update status or needs_callback
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = {};

  if ('status' in req.body) updates.status = req.body.status;
  if ('needs_callback' in req.body) updates.needs_callback = req.body.needs_callback;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .eq('source', 'phone')
    .select()
    .single();

  if (error) {
    logger.error({ err: error.message, id }, 'Failed to update phone order');
    return res.status(500).json({ error: 'Failed to update order' });
  }

  return res.json(data);
});

module.exports = router;
