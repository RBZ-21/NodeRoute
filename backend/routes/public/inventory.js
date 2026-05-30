'use strict';

const express = require('express');
const { supabase } = require('../../services/supabase');
const logger = require('../../services/logger');

const router = express.Router();

// GET /api/public/inventory
// Validates x-api-key header against BLAND_INVENTORY_KEY.
// Returns a filtered view of current inventory safe for external consumption.
router.get('/', async (req, res) => {
  const key = process.env.BLAND_INVENTORY_KEY || '';
  if (!key || req.headers['x-api-key'] !== key) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabase
    .from('inventory')
    .select('item, category, unit, unit_size, on_hand_qty');

  if (error) {
    logger.error({ err: error.message }, 'Public inventory query failed');
    return res.status(500).json({ error: 'Failed to retrieve inventory' });
  }

  return res.json({ inventory: data || [] });
});

module.exports = router;
