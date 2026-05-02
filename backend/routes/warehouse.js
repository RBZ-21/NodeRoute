const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const WAREHOUSE_ROLES = ['admin', 'manager', 'warehouse'];

// GET /api/warehouse — summary stats
router.get('/', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { data: inventory, error: invErr } = await supabase
      .from('seafood_inventory')
      .select('id, description, quantity, unit, category, status');
    if (invErr) return res.status(500).json({ error: invErr.message });

    const { data: pos, error: poErr } = await supabase
      .from('purchase_orders')
      .select('id, status')
      .in('status', ['pending', 'ordered', 'in-transit']);
    if (poErr) return res.status(500).json({ error: poErr.message });

    const today = new Date().toISOString().slice(0, 10);
    const { data: stops, error: stopErr } = await supabase
      .from('stops')
      .select('id, status, scheduled_date')
      .gte('scheduled_date', today)
      .lte('scheduled_date', today + 'T23:59:59');
    if (stopErr) return res.status(500).json({ error: stopErr.message });

    const { count: scanCount } = await supabase
      .from('warehouse_scans')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', today);

    const { count: openReturns } = await supabase
      .from('warehouse_returns')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');

    res.json({
      inventory: inventory || [],
      totalSkus: (inventory || []).length,
      pendingInbound: (pos || []).length,
      todayStops: (stops || []).length,
      todayStopsCompleted: (stops || []).filter((s) => s.status === 'completed').length,
      todayScans: scanCount || 0,
      openReturns: openReturns || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/inventory
router.get('/inventory', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('seafood_inventory')
      .select('*')
      .order('description');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/warehouse/inventory/:id
router.patch('/inventory/:id', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const ALLOWED = ['quantity', 'status', 'cost', 'description'];
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
    const { data, error } = await supabase
      .from('seafood_inventory')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LOCATIONS ─────────────────────────────────────────────────────────────────

// GET /api/warehouse/locations
router.get('/locations', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('warehouse_locations')
      .select('*')
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/locations
router.post('/locations', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, capacity, notes } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    const { data, error } = await supabase
      .from('warehouse_locations')
      .insert([{ name, type, capacity: capacity || null, notes: notes || null }])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/warehouse/locations/:id
router.patch('/locations/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const ALLOWED = ['name', 'type', 'capacity', 'notes', 'status'];
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
    const { data, error } = await supabase
      .from('warehouse_locations')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/warehouse/locations/:id
router.delete('/locations/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('warehouse_locations')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SCAN EVENTS ───────────────────────────────────────────────────────────────

// GET /api/warehouse/scans
router.get('/scans', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const { action, item_number, location_id, date } = req.query;
    let query = supabase
      .from('warehouse_scans')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (action) query = query.eq('action', action);
    if (item_number) query = query.eq('item_number', item_number);
    if (location_id) query = query.eq('location_id', location_id);
    if (date) {
      query = query.gte('created_at', date).lte('created_at', date + 'T23:59:59');
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/scans
router.post('/scans', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { item_number, action, quantity, unit, location_id, lot_number, notes } = req.body;
    if (!item_number || !action) return res.status(400).json({ error: 'item_number and action are required' });
    const VALID_ACTIONS = ['scan', 'receive', 'pick', 'adjust', 'transfer'];
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
    }
    const { data, error } = await supabase
      .from('warehouse_scans')
      .insert([{
        item_number,
        action,
        quantity: quantity != null ? quantity : null,
        unit: unit || null,
        location_id: location_id || null,
        lot_number: lot_number || null,
        notes: notes || null,
        performed_by: req.user?.id || null,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RETURNS ───────────────────────────────────────────────────────────────────

// GET /api/warehouse/returns
router.get('/returns', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('warehouse_returns')
      .select('*')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/returns
router.post('/returns', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { customer_id, customer_name, item_number, item_description, quantity, unit, reason, lot_number, notes } = req.body;
    if (!item_number || !quantity || !reason) {
      return res.status(400).json({ error: 'item_number, quantity, and reason are required' });
    }
    const { data, error } = await supabase
      .from('warehouse_returns')
      .insert([{
        customer_id: customer_id || null,
        customer_name: customer_name || null,
        item_number,
        item_description: item_description || null,
        quantity,
        unit: unit || null,
        reason,
        lot_number: lot_number || null,
        notes: notes || null,
        status: 'open',
        reported_by: req.user?.id || null,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/warehouse/returns/:id
router.patch('/returns/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const ALLOWED = ['status', 'resolution', 'notes', 'restocked'];
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
    const { data, error } = await supabase
      .from('warehouse_returns')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
