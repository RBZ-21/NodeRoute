const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

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

router.get('/location', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('driver_locations')
    .select('driver_name, lat, lng, heading, speed_mph, updated_at')
    .ilike('driver_name', req.user.name)
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  res.json((data && data[0]) || null);
});

router.patch('/location', authenticateToken, requireRole('driver', 'manager', 'admin'), async (req, res) => {
  const payload = {
    driver_name: req.user.name,
    lat: Number(req.body.lat),
    lng: Number(req.body.lng),
    heading: Number.isFinite(Number(req.body.heading)) ? Number(req.body.heading) : 0,
    speed_mph: Number.isFinite(Number(req.body.speed_mph)) ? Number(req.body.speed_mph) : 0,
    updated_at: new Date().toISOString(),
  };

  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return res.status(400).json({ error: 'Valid lat and lng are required' });
  }

  const { data, error } = await supabase
    .from('driver_locations')
    .upsert([payload], { onConflict: 'driver_name' })
    .select('driver_name, lat, lng, heading, speed_mph, updated_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
