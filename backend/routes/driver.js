const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/driver/routes — this driver's routes with hydrated stops (incl. door_code)
router.get('/routes', authenticateToken, async (req, res) => {
  const { data: routes, error: rErr } = await supabase
    .from('routes')
    .select('*')
    .ilike('driver', req.user.name)
    .order('created_at', { ascending: false });

  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!routes || !routes.length) return res.json([]);

  const allIds = [...new Set(routes.flatMap(r => r.stop_ids || []))];
  if (!allIds.length) return res.json(routes.map(r => ({ ...r, stops: [] })));

  const { data: stops, error: sErr } = await supabase
    .from('stops')
    .select('id, name, address, lat, lng, notes, door_code')
    .in('id', allIds);

  if (sErr) return res.status(500).json({ error: sErr.message });

  // For stops without a door code, try to match via portal_contacts by name
  const namesToLookup = (stops || [])
    .filter(s => !s.door_code && s.name)
    .map(s => s.name);

  let contactCodeMap = {};
  if (namesToLookup.length) {
    const { data: contacts } = await supabase
      .from('portal_contacts')
      .select('name, door_code')
      .not('door_code', 'is', null);
    (contacts || []).forEach(c => {
      if (c.name) contactCodeMap[c.name.toLowerCase().trim()] = c.door_code;
    });
  }

  const stopMap = {};
  (stops || []).forEach(s => {
    const code = s.door_code || contactCodeMap[(s.name || '').toLowerCase().trim()] || null;
    stopMap[s.id] = { ...s, door_code: code };
  });

  return res.json(routes.map(r => ({
    ...r,
    stops: (r.stop_ids || [])
      .map((id, i) => stopMap[id] ? { ...stopMap[id], position: i + 1 } : null)
      .filter(Boolean),
  })));
});

module.exports = router;
