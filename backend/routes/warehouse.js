const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/warehouse — summary stats for the warehouse page
router.get('/', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
  try {
    // Inventory on-hand counts — uses seafood_inventory (canonical table)
    const { data: inventory, error: invErr } = await supabase
      .from('seafood_inventory')
      .select('id, description, quantity, unit, category, status');
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
      totalSkus: (inventory || []).length,
      pendingInbound: (pos || []).length,
      todayStops: (stops || []).length,
      todayStopsCompleted: (stops || []).filter((s) => s.status === 'completed').length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/inventory — full seafood_inventory list for warehouse view
router.get('/inventory', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
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

// PATCH /api/warehouse/inventory/:id — update a single seafood_inventory item
router.patch('/inventory/:id', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
  try {
    // Only allow safe fields that exist on seafood_inventory
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

module.exports = router;
