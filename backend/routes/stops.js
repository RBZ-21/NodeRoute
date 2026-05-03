const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  buildScopeFields,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const STOP_FIELDS = [
  'route_id', 'customer_id', 'address', 'status',
  'scheduled_date', 'scheduled_time', 'notes', 'driver_id',
  'driver_notes', 'door_code',
  'signature_data', 'signature_captured_at', 'signature_captured_by',
  'weight_lbs', 'weight_captured_at', 'weight_captured_by',
];

// Fields a driver is allowed to self-update on their own stops
const DRIVER_ALLOWED_FIELDS = ['driver_notes', 'door_code', 'status'];

/**
 * Returns true when the given route row is assigned to the user.
 * Checks driver_id (UUID match) first, then driver name string.
 */
function isRouteAssignedToUser(route, user) {
  if (!route || !user) return false;
  if (route.driver_id && String(route.driver_id) === String(user.id)) return true;
  if (route.driver && String(route.driver).toLowerCase().trim() === String(user.name || '').toLowerCase().trim()) return true;
  return false;
}

/**
 * Shared guard for arrive/depart dwell events.
 * Loads the route, verifies stop membership, and verifies driver assignment.
 * Returns { ok: true, route, stop } on success or sends a 4xx response and returns { ok: false }.
 */
async function authorizeDwellEvent(req, res, stopId) {
  const { data: stop, error: stopErr } = await supabase
    .from('stops').select('*').eq('id', stopId).single();
  if (stopErr || !stop) {
    res.status(404).json({ error: 'Stop not found' });
    return { ok: false };
  }

  if (!stop.route_id) {
    res.status(400).json({ error: 'Stop is not assigned to a route' });
    return { ok: false };
  }

  const { data: route, error: routeErr } = await supabase
    .from('routes').select('*').eq('id', stop.route_id).single();
  if (routeErr || !route) {
    res.status(404).json({ error: 'Route not found' });
    return { ok: false };
  }

  // Verify driver assignment (drivers only; admins/managers bypass)
  if (req.user.role === 'driver' && !isRouteAssignedToUser(route, req.user)) {
    res.status(403).json({ error: 'Route is not assigned to this driver' });
    return { ok: false };
  }

  // Verify stop membership using active_stop_ids if present, else stop_ids
  const activeIds = Array.isArray(route.active_stop_ids) && route.active_stop_ids.length
    ? route.active_stop_ids
    : (Array.isArray(route.stop_ids) ? route.stop_ids : []);
  if (activeIds.length && !activeIds.includes(stopId)) {
    res.status(400).json({ error: 'Stop is not part of this route' });
    return { ok: false };
  }

  return { ok: true, route, stop };
}

// GET /api/stops
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = supabase.from('stops').select('*');
    if (req.query.route_id) query = query.eq('route_id', req.query.route_id);
    if (req.query.driver_id) query = query.eq('driver_id', req.query.driver_id);
    if (req.query.status)   query = query.eq('status', req.query.status);
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
    const result = await insertRecordWithOptionalScope(supabase, 'stops', payload, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.status(201).json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/stops/:id
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
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

    // Admins / managers: load existing row and verify tenant context
    const { data: existing, error: fetchErr } = await supabase
      .from('stops').select('*').eq('id', req.params.id).single();
    if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
    if (!rowMatchesContext(existing, req.context)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

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

// POST /api/stops/:id/arrive — driver marks arrival, inserts a dwell_record
router.post('/:id/arrive', authenticateToken, async (req, res) => {
  try {
    const auth = await authorizeDwellEvent(req, res, req.params.id);
    if (!auth.ok) return;
    const { route } = auth;

    // Idempotency: return existing open record if already checked in
    const { data: existing } = await supabase
      .from('dwell_records')
      .select('*')
      .eq('stop_id', req.params.id)
      .eq('route_id', route.id)
      .is('departed_at', null)
      .limit(1);
    if (existing && existing[0]) return res.json(existing[0]);

    // Mark stop as arrived
    await supabase.from('stops').update({ status: 'arrived', arrived_at: new Date().toISOString() }).eq('id', req.params.id);

    // Insert dwell record
    const arrivedAt = new Date().toISOString();
    const { data: record, error: insertErr } = await supabase
      .from('dwell_records')
      .insert([{
        stop_id:    req.params.id,
        route_id:   route.id,
        driver_id:  req.user.id,
        arrived_at: arrivedAt,
        departed_at: null,
        dwell_ms:   null,
        ...buildScopeFields(req.context),
      }])
      .select()
      .single();
    if (insertErr) return res.status(500).json({ error: insertErr.message });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/depart — driver marks departure, updates the open dwell record
router.post('/:id/depart', authenticateToken, async (req, res) => {
  try {
    const auth = await authorizeDwellEvent(req, res, req.params.id);
    if (!auth.ok) return;
    const { route } = auth;

    const { data: openRecords, error: findErr } = await supabase
      .from('dwell_records')
      .select('*')
      .eq('stop_id', req.params.id)
      .eq('route_id', route.id)
      .is('departed_at', null)
      .limit(1);
    if (findErr) return res.status(500).json({ error: findErr.message });
    if (!openRecords || !openRecords[0]) {
      return res.status(404).json({ error: 'No open dwell record found — call /arrive first' });
    }

    const openRecord = openRecords[0];
    const departedAt = new Date().toISOString();
    const dwell_ms = new Date(departedAt).getTime() - new Date(openRecord.arrived_at).getTime();

    const { data: updated, error: updateErr } = await supabase
      .from('dwell_records')
      .update({ departed_at: departedAt, dwell_ms })
      .eq('id', openRecord.id)
      .select()
      .single();
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Also update stop status
    await supabase.from('stops').update({ status: 'completed' }).eq('id', req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/signature — save a delivery signature
router.post('/:id/signature', authenticateToken, async (req, res) => {
  try {
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
    const { data: existing, error: fetchErr } = await supabase
      .from('stops').select('*').eq('id', req.params.id).single();
    if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
    if (!rowMatchesContext(existing, req.context)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { error } = await supabase.from('stops').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.isRouteAssignedToUser = isRouteAssignedToUser;
