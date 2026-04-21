const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── DWELL TIME (geofence check-in/out) ──────────────────
const dwellRecords = []; // { id, stopId, routeId, driverId, arrivedAt, departedAt, dwellMs }

router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('stops').select('*').order('created_at', { ascending: true }), res);
  if (!data) return;
  res.json(data);
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, address, lat, lng, notes } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Name and address required' });
  const data = await dbQuery(supabase.from('stops').insert([{ name, address, lat: parseFloat(lat)||0, lng: parseFloat(lng)||0, notes: notes||'' }]).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('stops').update(req.body).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('stops').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

router.post('/:id/arrive', authenticateToken, (req, res) => {
  const { routeId } = req.body;
  const existing = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (existing) return res.json(existing);
  const record = { id: 'dwell-' + Date.now(), stopId: req.params.id, routeId: routeId||'', driverId: req.user.id, arrivedAt: new Date().toISOString(), departedAt: null, dwellMs: null };
  dwellRecords.push(record);
  res.json(record);
});

router.post('/:id/depart', authenticateToken, (req, res) => {
  const { routeId } = req.body;
  const record = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (!record) return res.status(404).json({ error: 'No active arrival found' });
  record.departedAt = new Date().toISOString();
  record.dwellMs = new Date(record.departedAt) - new Date(record.arrivedAt);
  res.json(record);
});

module.exports = router;
module.exports.dwellRecords = dwellRecords;
