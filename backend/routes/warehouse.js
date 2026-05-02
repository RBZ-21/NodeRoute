const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/warehouse — summary stats for the warehouse page
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Inventory on-hand counts
    const { data: inventory, error: invErr } = await supabase
      .from('inventory')
      .select('id, name, quantity, unit, category, status');
    if (invErr) return res.status(500).json({ error: invErr.message });

    // Pending inbound purchase orders
    const { data: pos, error: poErr } = await supabase
      .from('purchase_orders')
      .select('id, status, vendor_id')
      .in('status', ['pending', 'ordered', 'in-transit']);
    if (poErr) return res.status(500).json({ error: poErr.message });

    // Today's outbound stops
    const today = new Date().toISOString().slice(0, 10);
    const { data: stops, error: stopErr } = await supabase
      .from('stops')
      .select('id, status, scheduled_date')
      .gte('scheduled_date', today)
      .lte('scheduled_date', today + 'T23:59:59');
    if (stopErr) return res.status(500).json({ error: stopErr.message });

    res.json({
      inventory: inventory || [],
      pendingInbound: (pos || []).length,
      todayStops: (stops || []).length,
      todayStopsCompleted: (stops || []).filter((s) => s.status === 'completed').length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/inventory — full inventory list for warehouse view
router.get('/inventory', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/warehouse/inventory/:id — update a single inventory item (qty adjustment etc.)
router.patch('/inventory/:id', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
  try {
    const ALLOWED = ['quantity', 'status', 'location', 'notes'];
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
    const { data, error } = await supabase
      .from('inventory')
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
