const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { supabase } = require('../services/supabase');

const router = express.Router();

// Move a stop to the end of its queue
async function reorderStopToEnd(stopId, queueIdOverride) {
  // Fetch the target stop
  const { data: stop, error: stopErr } = await supabase.from('stops').select('*').eq('id', stopId).single();
  if (stopErr) throw new Error(stopErr.message);
  if (!stop) throw new Error('Stop not found');

  const targetQueueId = queueIdOverride ?? stop.queue_id ?? null;
  // Get all stops in the same queue ordered by position
  const { data: stops, error: listErr } = await supabase.from('stops').select('id, position').eq('queue_id', targetQueueId).order('position', { ascending: true });
  if (listErr) throw new Error(listErr.message);
  const list = Array.isArray(stops) ? stops : [];

  // Build new order: remove target, append to end
  const withNoTarget = list.filter((s) => s.id !== stopId);
  const newOrder = [...withNoTarget.map((s, idx) => ({ id: s.id, position: idx + 1 })), { id: stopId, position: withNoTarget.length + 1 }];

  // Apply updates sequentially to preserve order
  for (const item of newOrder) {
    const { id, position } = item;
    await supabase.from('stops').update({ position }).eq('id', id);
  }

  // Return updated list for the queue
  const { data: updated, error: updErr } = await supabase.from('stops').select('*').eq('queue_id', targetQueueId).order('position', { ascending: true });
  if (updErr) throw new Error(updErr.message);
  return updated;
}

// GET: list stops for a queue (optional queueId param)
router.get('/', authenticateToken, async (req, res) => {
  const queueId = req.query.queueId ?? null;
  try {
    const { data, error } = await supabase.from('stops').select('*').eq('queue_id', queueId).order('position', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Failed to fetch stops' });
  }
});

// POST: move a stop to the end of its queue (existing)
router.post('/:id/move-to-end', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const queueIdOverride = req.body.queueId ?? req.query.queueId ?? null;
  // If a driver is performing this action, validate route ownership if possible
  try {
    const user = req.user || {};
    const isDriver = String(user?.role || '').toLowerCase() === 'driver';
    if (isDriver) {
      const { data: stopRec } = await supabase.from('stops').select('queue_id').eq('id', stopId).single();
      const targetQueue = queueIdOverride ?? stopRec?.queue_id ?? null;
      if (targetQueue) {
        const { data: route } = await supabase.from('routes').select('driver_id').eq('id', targetQueue).single();
        const assignedDriver = route?.driver_id;
        if (assignedDriver && String(assignedDriver) !== String(user?.id)) {
          return res.status(403).json({ ok: false, error: 'Not authorized for this route' });
        }
      }
    }
  } catch (authErr) {
    // If anything goes wrong, fall back to allowing the operation but log for audit
    // eslint-disable-next-line no-console
    console.error('[stops] driver-authorization-fallback', authErr?.message || authErr);
  }
  try {
    const updatedStops = await reorderStopToEnd(stopId, queueIdOverride);
    res.json({ ok: true, stops: updatedStops });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Could not reorder stop' });
  }
  });

// POST: add notes to a stop (driver/ops can annotate delivery instructions)
router.post('/:id/notes', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const { notes } = req.body;
  if (typeof notes !== 'string') {
    return res.status(400).json({ ok: false, error: 'notes must be a string' });
  }
  try {
    const { data: updated, error } = await supabase.from('stops').update({ notes }).eq('id', stopId).select('*').single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, stop: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Could not update notes' });
  }
});

// Helpers: determine if a driver is authorized to modify this stop (best-effort)
async function canDriverAccessStop(stopId, user) {
  if (!stopId) return false;
  const role = String((user?.role || '').toLowerCase());
  if (role !== 'driver') return true; // non-drivers are allowed through by role check
  try {
    const { data: stopRec } = await supabase.from('stops').select('queue_id').eq('id', stopId).single();
    const queueId = stopRec?.queue_id ?? null;
    if (!queueId) return true;
    const { data: route } = await supabase.from('routes').select('driver_id').eq('id', queueId).single();
    if (route?.driver_id && String(route.driver_id) !== String(user?.id)) {
      return false;
    }
    return true;
  } catch {
    // If we can't determine ownership, allow the operation by default
    return true;
  }
}

// POST: arrive at a stop (Driver action)
router.post('/:id/arrive', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const user = req.user || {};
  if (!(await canDriverAccessStop(stopId, user))) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this stop' });
  }
  try {
    const now = new Date().toISOString();
    const { data: stop, error } = await supabase.from('stops').update({ arrived_at: now }).eq('id', stopId).select('*').single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, stop });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'Could not mark arrived' });
  }
});

// POST: depart from a stop (Driver action)
router.post('/:id/depart', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const user = req.user || {};
  if (!(await canDriverAccessStop(stopId, user))) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this stop' });
  }
  try {
    const now = new Date().toISOString();
    const { data: stop, error } = await supabase.from('stops').update({ departed_at: now }).eq('id', stopId).select('*').single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, stop });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'Could not mark departed' });
  }
});

// POST: record a driver signature for a stop (best-effort; uses signature column if present)
router.post('/:id/signature', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const { signature } = req.body;
  const user = req.user || {};
  if (!(await canDriverAccessStop(stopId, user))) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this stop' });
  }
  try {
    // Try primary column first
    let result = await supabase.from('stops').update({ signature }).eq('id', stopId).select('*').single();
    if (result.error && result.error.message.includes('column "signature" does not exist')) {
      // Fallback: try alternative column name
      result = await supabase.from('stops').update({ driver_signature: signature }).eq('id', stopId).select('*').single();
    }
    if (result.error) return res.status(500).json({ ok: false, error: result.error.message });
    res.json({ ok: true, stop: result.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'Could not save signature' });
  }
});

// POST: record weight for a stop (best-effort with fallbacks)
router.post('/:id/weight', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const { weight } = req.body;
  const user = req.user || {};
  if (!(await canDriverAccessStop(stopId, user))) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this stop' });
  }
  try {
    // Try a few common column names
    const candidates = [{ weight } , { estimated_weight: weight }, { requested_weight: weight }];
    let updated = null;
    for (const cand of candidates) {
      const resQ = await supabase.from('stops').update(cand).eq('id', stopId).select('*').single();
      if (!resQ.error) { updated = resQ.data; break; }
    }
    if (!updated) return res.status(500).json({ ok: false, error: 'Could not set weight' });
    res.json({ ok: true, stop: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'Could not set weight' });
  }
});

// POST: defer a stop to end (alias for move-to-end)
router.post('/:id/defer', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const queueIdOverride = req.body.queueId ?? req.query.queueId ?? null;
  // Reuse existing authorization guard for drivers
  const user = req.user || {};
  if (!await canDriverAccessStop(stopId, user)) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this stop' });
  }
  try {
    const updatedStops = await reorderStopToEnd(stopId, queueIdOverride);
    res.json({ ok: true, stops: updatedStops });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Could not defer stop' });
  }
});

module.exports = router;
