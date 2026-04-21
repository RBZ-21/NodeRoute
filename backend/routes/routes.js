const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

// ── ROUTES (Supabase) ───────────────────────────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('routes').select('*').order('created_at', { ascending: true }), res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, stopIds, driver, driverId, driverName, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name required' });
  const assignedDriverName = driverName || driver || '';
  const insertResult = await insertRecordWithOptionalScope(supabase, 'routes', {
    name,
    stop_ids: stopIds || [],
    driver: assignedDriverName,
    driver_id: driverId || null,
    notes: notes || '',
  }, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('routes').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Route not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const payload = { ...req.body };
  if (payload.stopIds !== undefined) { payload.stop_ids = payload.stopIds; delete payload.stopIds; }
  if (payload.driverName !== undefined) { payload.driver = payload.driverName || ''; delete payload.driverName; }
  if (payload.driverId !== undefined) { payload.driver_id = payload.driverId || null; delete payload.driverId; }
  const data = await dbQuery(supabase.from('routes').update(payload).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('routes').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Route not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('routes').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
