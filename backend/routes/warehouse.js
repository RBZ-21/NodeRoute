const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const WAREHOUSE_ROLES = ['admin', 'manager', 'warehouse'];

function scopeQuery(query, context) {
  const scope = buildScopeFields(context || {});
  if (scope.company_id) query = query.eq('company_id', scope.company_id);
  if (scope.location_id) query = query.eq('location_id', scope.location_id);
  return query;
}

function toNumber(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// GET /api/warehouse — summary stats
router.get('/', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { data: inventory, error: invErr } = await supabase
      .from('products')
      .select('id, item_number, description, on_hand_qty, unit, category, status, company_id, location_id');
    if (invErr) return res.status(500).json({ error: invErr.message });

    const { data: pos, error: poErr } = await supabase
      .from('purchase_orders')
      .select('id, status, company_id, location_id')
      .in('status', ['pending', 'ordered', 'in-transit']);
    if (poErr) return res.status(500).json({ error: poErr.message });

    const today = new Date().toISOString().slice(0, 10);
    const { data: stops, error: stopErr } = await supabase
      .from('stops')
      .select('id, status, scheduled_date, company_id, location_id')
      .gte('scheduled_date', today)
      .lte('scheduled_date', today + 'T23:59:59');
    if (stopErr) return res.status(500).json({ error: stopErr.message });

    const scanQuery = supabase
      .from('warehouse_scans')
      .select('id, company_id, location_id')
      .gte('created_at', today);
    const { data: scans } = await scopeQuery(scanQuery, req.context);

    const returnsQuery = supabase
      .from('warehouse_returns')
      .select('id, company_id, location_id')
      .eq('status', 'open');
    const { data: returns } = await scopeQuery(returnsQuery, req.context);

    const scopedInventory = filterRowsByContext(inventory || [], req.context);
    const scopedPos = filterRowsByContext(pos || [], req.context);
    const scopedStops = filterRowsByContext(stops || [], req.context);

    res.json({
      inventory: scopedInventory,
      totalSkus: scopedInventory.length,
      pendingInbound: scopedPos.length,
      todayStops: scopedStops.length,
      todayStopsCompleted: scopedStops.filter((s) => s.status === 'completed').length,
      todayScans: (scans || []).length,
      openReturns: (returns || []).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/inventory
router.get('/inventory', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('description');
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/warehouse/inventory/:id
// Note: `quantity` is intentionally NOT allowed here — quantity changes must
// flow through the inventory ledger (see /api/inventory routes). Direct mutation
// would create a silent divergence between on_hand_qty and inventory_stock_history.
router.patch('/inventory/:id', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Inventory item not found' });
    if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

    const ALLOWED = ['status', 'cost', 'description'];
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    let data = existing;
    if (req.body.quantity !== undefined || req.body.on_hand_qty !== undefined) {
      const nextQty = toNumber(req.body.quantity ?? req.body.on_hand_qty, NaN);
      if (!Number.isFinite(nextQty) || nextQty < 0) {
        return res.status(400).json({ error: 'quantity must be a non-negative number' });
      }
      const ledger = await applyInventoryLedgerEntry({
        itemNumber: existing.item_number,
        changeType: 'warehouse_count',
        notes: req.body.notes || 'Warehouse inventory adjustment',
        createdBy: req.user?.name || req.user?.email || 'warehouse',
        setAbsoluteQty: nextQty,
        preventNegative: false,
        context: req.context,
      });
      data = ledger.item_after;
    }
    if (Object.keys(update).length) {
      const { data: updated, error } = await supabase
        .from('products')
        .update(update)
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      data = updated;
    }
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
    res.json(filterRowsByContext(data || [], req.context));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/locations
router.post('/locations', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, notes } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    const result = await insertRecordWithOptionalScope(
      supabase,
      'warehouse_locations',
      { name, type, notes: notes || null },
      req.context
    );
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.status(201).json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/warehouse/locations/:id
router.patch('/locations/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const ALLOWED = ['name', 'type', 'notes', 'status'];
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
    const { data: existing, error: fetchErr } = await supabase
      .from('warehouse_locations')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Location not found' });
    if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
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
    const { data: existing, error: fetchErr } = await supabase
      .from('warehouse_locations')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Location not found' });
    if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
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
    if (location_id) query = query.eq('warehouse_location_id', location_id);
    if (date) {
      query = query.gte('created_at', date).lte('created_at', date + 'T23:59:59');
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
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
    const result = await insertRecordWithOptionalScope(supabase, 'warehouse_scans', {
      item_number,
      action,
      quantity: quantity != null ? quantity : null,
      unit: unit || null,
      warehouse_location_id: location_id || null,
      lot_number: lot_number || null,
      notes: notes || null,
      performed_by: req.user?.id || null,
      created_at: new Date().toISOString(),
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.status(201).json(result.data);
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
    res.json(filterRowsByContext(data || [], req.context));
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
    const result = await insertRecordWithOptionalScope(supabase, 'warehouse_returns', {
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
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.status(201).json(result.data);
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
    const { data: existing, error: fetchErr } = await supabase
      .from('warehouse_returns')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Return not found' });
    if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
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
