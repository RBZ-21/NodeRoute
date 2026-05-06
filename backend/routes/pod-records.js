const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { supabase } = require('../services/supabase');

const router = express.Router();

// Create a POD record for a stop/order delivery
router.post('/pod-records', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const { orderId, stopId, type, signature, photos, notes } = req.body;
  if (!orderId && !stopId) {
    return res.status(400).json({ error: 'orderId or stopId is required' });
  }
  if (!['signature', 'photo'].includes(type)) {
    return res.status(400).json({ error: 'type must be either signature or photo' });
  }
  const payload = {
    order_id: orderId || null,
    stop_id: stopId || null,
    type,
    data: {
      signature: signature || null,
      photos: Array.isArray(photos) ? photos : photos ? [photos] : [],
      notes: notes || null,
    },
    created_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase.from('pod_records').insert([payload]).single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, pod: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to create pod record' });
  }
});

module.exports = router;
