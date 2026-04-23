const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');

const router = express.Router();

function dateKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeTemperaturePayload(body, user) {
  const temperature = parseFloat(body.temperature);
  const loggedAt = body.logged_at || body.loggedAt || new Date().toISOString();
  const parsedLoggedAt = new Date(loggedAt);
  return {
    logged_at: Number.isNaN(parsedLoggedAt.getTime()) ? null : parsedLoggedAt.toISOString(),
    storage_area: String(body.storage_area || body.storageArea || '').trim(),
    temperature,
    unit: body.unit || 'F',
    check_type: body.check_type || body.checkType || 'routine',
    corrective_action: body.corrective_action || body.correctiveAction || null,
    initials: body.initials || null,
    notes: body.notes || null,
    recorded_by: user?.name || user?.email || null,
  };
}

router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('temperature_logs').select('*').order('logged_at', { ascending: false }), res);
  if (!data) return;
  let rows = filterRowsByContext(data, req.context);
  if (req.query.date) {
    rows = rows.filter((row) => dateKey(row.logged_at) === req.query.date);
  }
  res.json(rows);
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const payload = normalizeTemperaturePayload(req.body || {}, req.user);
  if (!payload.storage_area) return res.status(400).json({ error: 'Storage area is required' });
  if (!Number.isFinite(payload.temperature)) return res.status(400).json({ error: 'Temperature is required' });
  if (Number.isNaN(new Date(payload.logged_at).getTime())) return res.status(400).json({ error: 'Valid log time is required' });

  const insertResult = await insertRecordWithOptionalScope(supabase, 'temperature_logs', payload, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  res.json(insertResult.data);
});

module.exports = router;
