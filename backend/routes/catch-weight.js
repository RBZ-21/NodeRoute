/**
 * /api/catch-weight
 *
 * Catch-weight item management — tracks items sold/purchased by both
 * count and actual weight (e.g. whole fish, live shellfish).
 */

const express = require('express');
const router  = express.Router();
const { supabase }                       = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);

// GET /api/catch-weight — list all catch-weight records for the tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    let query = supabase.from('catch_weight_items').select('*');
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catch-weight/:id
router.get('/:id', async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    let query = supabase.from('catch_weight_items').select('*').eq('id', req.params.id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.single();
    if (error) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/catch-weight — create a catch-weight record
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    const {
      lot_number, item_number, description,
      nominal_weight, actual_weight, unit_count,
      order_id, notes,
    } = req.body;

    const { data, error } = await supabase
      .from('catch_weight_items')
      .insert([{
        tenant_id: tenantId, lot_number, item_number, description,
        nominal_weight, actual_weight, unit_count, order_id, notes,
      }])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/catch-weight/:id — update fields
router.patch('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    const allowed = [
      'lot_number', 'item_number', 'description',
      'nominal_weight', 'actual_weight', 'unit_count',
      'order_id', 'notes',
    ];
    const patch = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    let query = supabase.from('catch_weight_items').update(patch).eq('id', req.params.id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.select().single();
    if (error) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/catch-weight/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    let query = supabase.from('catch_weight_items').delete().eq('id', req.params.id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { error } = await query;
    if (error) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
