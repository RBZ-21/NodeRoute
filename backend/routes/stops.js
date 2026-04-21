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

router.post('/:id/arrive', authenticateToken, requireRole('driver', 'admin', 'manager'), (req, res) => {
  const { routeId } = req.body;
  const existing = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (existing) return res.json(existing);
  const record = { id: 'dwell-' + Date.now(), stopId: req.params.id, routeId: routeId||'', driverId: req.user.id, arrivedAt: new Date().toISOString(), departedAt: null, dwellMs: null };
  dwellRecords.push(record);
  res.json(record);
});

router.post('/:id/depart', authenticateToken, requireRole('driver', 'admin', 'manager'), (req, res) => {
  const { routeId } = req.body;
  const record = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (!record) return res.status(404).json({ error: 'No active arrival found' });
  record.departedAt = new Date().toISOString();
  record.dwellMs = new Date(record.departedAt) - new Date(record.arrivedAt);
  res.json(record);
});

module.exports = router;
module.exports.dwellRecords = dwellRecords;
