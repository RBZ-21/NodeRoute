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

// POST: move a stop to the end of its queue
router.post('/:id/move-to-end', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const stopId = req.params.id;
  const queueIdOverride = req.body.queueId ?? req.query.queueId ?? null;
  try {
    const updatedStops = await reorderStopToEnd(stopId, queueIdOverride);
    res.json({ ok: true, stops: updatedStops });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Could not reorder stop' });
  }
});

module.exports = router;
