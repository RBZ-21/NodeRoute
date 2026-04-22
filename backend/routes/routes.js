const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

function normalizeStopIds(value) {
  if (Array.isArray(value)) return value.map(id => String(id || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(id => id.trim()).filter(Boolean);
  return [];
}

// ── ROUTES (Supabase) ───────────────────────────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('routes').select('*').order('created_at', { ascending: true }), res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, stopIds, activeStopIds, driver, driverId, driverName, notes } = req.body;
  const templateStopIds = normalizeStopIds(stopIds);
  const routeName = String(name || '').trim();
  if (!routeName) return res.status(400).json({ error: 'Route name required' });
  const assignedDriverName = driverName || driver || '';
  const payload = {
    name: routeName,
    stop_ids: templateStopIds,
    active_stop_ids: activeStopIds === undefined ? templateStopIds : normalizeStopIds(activeStopIds),
    driver: assignedDriverName,
    notes: notes || '',
  };
  if (driverId) payload.driver_id = driverId;
  const insertResult = await insertRecordWithOptionalScope(supabase, 'routes', payload, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('routes').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Route not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const payload = {};
  if (req.body.name !== undefined) payload.name = String(req.body.name || '').trim();
  if (req.body.stopIds !== undefined) {
    payload.stop_ids = normalizeStopIds(req.body.stopIds);
    if (req.body.activeStopIds === undefined && req.body.active_stop_ids === undefined) {
      payload.active_stop_ids = payload.stop_ids;
    }
  }
  if (req.body.stop_ids !== undefined) {
    payload.stop_ids = normalizeStopIds(req.body.stop_ids);
    if (req.body.activeStopIds === undefined && req.body.active_stop_ids === undefined) {
      payload.active_stop_ids = payload.stop_ids;
    }
  }
  if (req.body.activeStopIds !== undefined) payload.active_stop_ids = normalizeStopIds(req.body.activeStopIds);
  if (req.body.active_stop_ids !== undefined) payload.active_stop_ids = normalizeStopIds(req.body.active_stop_ids);
  if (req.body.driverName !== undefined) payload.driver = req.body.driverName || '';
  if (req.body.driver !== undefined) payload.driver = req.body.driver || '';
  if (req.body.driverId !== undefined) payload.driver_id = req.body.driverId || null;
  if (req.body.driver_id !== undefined) payload.driver_id = req.body.driver_id || null;
  if (req.body.notes !== undefined) payload.notes = req.body.notes || '';
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'No valid route fields provided' });
  if (payload.name === '') return res.status(400).json({ error: 'Route name required' });
  const updateResult = await executeWithOptionalScope(
    (candidate) => supabase.from('routes').update(candidate).eq('id', req.params.id).select().single(),
    payload
  );
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
  const data = updateResult.data;
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
module.exports.normalizeStopIds = normalizeStopIds;
