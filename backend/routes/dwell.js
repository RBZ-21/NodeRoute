/**
 * routes/dwell.js
 * GET /api/dwell — returns dwell records.
 * Drivers see only their own records; all other roles see everything.
 */
const express = require('express');
const router  = express.Router();
const { supabase }          = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { scopeQueryByContext } = require('../services/operating-context');

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = scopeQueryByContext(supabase.from('dwell_records').select('*'), req.context);
    if (req.user.role === 'driver') {
      query = query.eq('driver_id', req.user.id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
