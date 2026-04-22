const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();
const STOP_FIELDS = ['name', 'address', 'lat', 'lng', 'notes'];

function stopPayload(source) {
  const payload = {};
  STOP_FIELDS.forEach(field => {
    if (source[field] !== undefined) payload[field] = source[field];
  });
  if (payload.lat !== undefined) payload.lat = parseFloat(payload.lat) || 0;
  if (payload.lng !== undefined) payload.lng = parseFloat(payload.lng) || 0;
  if (payload.notes !== undefined) payload.notes = payload.notes || '';
  return payload;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isRouteAssignedToUser(route, user) {
  return (
    String(route?.driver_id || '') === String(user?.id || '') ||
    normalize(route?.driver_email) === normalize(user?.email) ||
    normalize(route?.driver) === normalize(user?.name)
  );
}

async function authorizeDwellEvent(req, res) {
  const routeId = String(req.body?.routeId || '').trim();
  if (!routeId) {
    res.status(400).json({ error: 'routeId is required' });
    return null;
  }

  const route = await dbQuery(supabase.from('routes').select('*').eq('id', routeId).single(), res);
  if (!route) return null;
  if (!rowMatchesContext(route, req.context)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const routeStopIds = Array.isArray(route.active_stop_ids) ? route.active_stop_ids : route.stop_ids;
  if (!Array.isArray(routeStopIds) || !routeStopIds.includes(req.params.id)) {
    res.status(403).json({ error: 'Stop is not part of this route' });
    return null;
  }
  if (req.user.role === 'driver' && !isRouteAssignedToUser(route, req.user)) {
    res.status(403).json({ error: 'Route is not assigned to this driver' });
    return null;
  }
  return { route, routeId };
}

// ── DWELL TIME (geofence check-in/out) ──────────────────
const dwellRecords = []; // { id, stopId, routeId, driverId, arrivedAt, departedAt, dwellMs }

router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('stops').select('*').order('created_at', { ascending: true }), res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, address, lat, lng, notes } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Name and address required' });
  const insertResult = await insertRecordWithOptionalScope(supabase, 'stops', {
    name,
    address,
    lat: parseFloat(lat) || 0,
    lng: parseFloat(lng) || 0,
    notes: notes || '',
  }, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('stops').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Stop not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('stops').update(stopPayload(req.body)).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('stops').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Stop not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('stops').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

router.post('/:id/arrive', authenticateToken, requireRole('driver', 'admin', 'manager'), async (req, res) => {
  const authorized = await authorizeDwellEvent(req, res);
  if (!authorized) return;
  const { routeId } = authorized;
  const existing = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (existing) return res.json(existing);
  const record = { id: 'dwell-' + Date.now(), stopId: req.params.id, routeId: routeId||'', driverId: req.user.id, arrivedAt: new Date().toISOString(), departedAt: null, dwellMs: null };
  dwellRecords.push(record);
  res.json(record);
});

router.post('/:id/depart', authenticateToken, requireRole('driver', 'admin', 'manager'), async (req, res) => {
  const authorized = await authorizeDwellEvent(req, res);
  if (!authorized) return;
  const { routeId } = authorized;
  const record = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (!record) return res.status(404).json({ error: 'No active arrival found' });
  record.departedAt = new Date().toISOString();
  record.dwellMs = new Date(record.departedAt) - new Date(record.arrivedAt);
  res.json(record);
});

module.exports = router;
module.exports.dwellRecords = dwellRecords;
module.exports.isRouteAssignedToUser = isRouteAssignedToUser;
