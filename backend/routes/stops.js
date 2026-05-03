const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const STOP_FIELDS = [
  'route_id', 'customer_id', 'address', 'status',
  'scheduled_date', 'scheduled_time', 'notes', 'driver_id',
  'driver_notes', 'door_code',
  'signature_data', 'signature_captured_at', 'signature_captured_by',
  'weight_lbs', 'weight_captured_at', 'weight_captured_by',
];

// Fields a driver is allowed to self-update on their own stops
const DRIVER_ALLOWED_FIELDS = ['driver_notes', 'door_code', 'status'];

// GET /api/stops
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = supabase.from('stops').select('*');
    if (req.query.route_id) query = query.eq('route_id', req.query.route_id);
    if (req.query.driver_id) query = query.eq('driver_id', req.query.driver_id);
    if (req.query.status)   query = query.eq('status', req.query.status);
    // Drivers can only see their own stops
    if (req.user.role === 'driver') query = query.eq('driver_id', req.user.id);
    query = query.order('created_at', { ascending: true });
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stops/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stops').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Stop not found' });
    // Drivers can only view their own stops
    if (req.user.role === 'driver' && String(data.driver_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const payload = {};
    for (const field of STOP_FIELDS) {
      if (req.body[field] !== undefined) payload[field] = req.body[field];
    }
    const { data, error } = await supabase.from('stops').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/stops/:id
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    // For drivers: verify ownership and restrict updatable fields
    if (req.user.role === 'driver') {
      const { data: existing, error: fetchErr } = await supabase
        .from('stops').select('driver_id').eq('id', req.params.id).single();
      if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
      if (String(existing.driver_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const update = {};
      for (const field of DRIVER_ALLOWED_FIELDS) {
        if (req.body[field] !== undefined) update[field] = req.body[field];
      }
      if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
      const { data, error } = await supabase
        .from('stops').update(update).eq('id', req.params.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // Admins / managers: full field set
    const update = {};
    for (const field of STOP_FIELDS) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
    const { data, error } = await supabase
      .from('stops').update(update).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/arrive — driver marks arrival at a stop
router.post('/:id/arrive', authenticateToken, async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('stops').select('driver_id, status').eq('id', req.params.id).single();
    if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
    // Drivers can only arrive their own stops
    if (req.user.role === 'driver' && String(existing.driver_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { data, error } = await supabase
      .from('stops')
      .update({
        status: 'arrived',
        arrived_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/signature — save a delivery signature
router.post('/:id/signature', authenticateToken, async (req, res) => {
  try {
    // Drivers can only sign their own stops
    if (req.user.role === 'driver') {
      const { data: existing, error: fetchErr } = await supabase
        .from('stops').select('driver_id').eq('id', req.params.id).single();
      if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
      if (String(existing.driver_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    const { signature_data, signer_name } = req.body;
    if (!signature_data) return res.status(400).json({ error: 'signature_data is required' });
    const { data, error } = await supabase
      .from('stops')
      .update({
        signature_data,
        signature_captured_at: new Date().toISOString(),
        signature_captured_by: signer_name || req.user.name || req.user.email,
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/weight — save captured weight
router.post('/:id/weight', authenticateToken, async (req, res) => {
  try {
    // Drivers can only record weight for their own stops
    if (req.user.role === 'driver') {
      const { data: existing, error: fetchErr } = await supabase
        .from('stops').select('driver_id').eq('id', req.params.id).single();
      if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
      if (String(existing.driver_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    const { weight_lbs } = req.body;
    if (weight_lbs === undefined || weight_lbs === null) {
      return res.status(400).json({ error: 'weight_lbs is required' });
    }
    const { data, error } = await supabase
      .from('stops')
      .update({
        weight_lbs: Number(weight_lbs),
        weight_captured_at: new Date().toISOString(),
        weight_captured_by: req.user.name || req.user.email,
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stops/:id
router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { error } = await supabase.from('stops').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
