const express = require('express');
const { z } = require('zod');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');
const { validateBody, validateQuery } = require('../lib/zod-validate');

const router = express.Router();

const temperatureLogQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
}).passthrough();

const temperatureLogBodySchema = z.object({
  temperature: z.coerce.number(),
  logged_at: z.string().optional(),
  loggedAt: z.string().optional(),
  storage_area: z.string().optional(),
  storageArea: z.string().optional(),
  unit: z.string().optional(),
  check_type: z.string().optional(),
  checkType: z.string().optional(),
  corrective_action: z.any().optional(),
  correctiveAction: z.any().optional(),
  initials: z.any().optional(),
  notes: z.any().optional(),
}).superRefine((body, ctx) => {
  const storageArea = String(body.storage_area || body.storageArea || '').trim();
  if (!storageArea) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Storage area is required' });
  }
  if (!Number.isFinite(body.temperature)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Temperature is required' });
  }
  const loggedAt = body.logged_at || body.loggedAt || new Date().toISOString();
  if (Number.isNaN(new Date(loggedAt).getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valid log time is required' });
  }
});

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

router.get('/', authenticateToken, requireRole('admin', 'manager'), validateQuery(temperatureLogQuerySchema), async (req, res) => {
  const data = await dbQuery(supabase.from('temperature_logs').select('*').order('logged_at', { ascending: false }), res);
  if (!data) return;
  let rows = filterRowsByContext(data, req.context);
  const { date } = req.validated.query;
  if (date) {
    rows = rows.filter((row) => dateKey(row.logged_at) === date);
  }
  res.json(rows);
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), validateBody(temperatureLogBodySchema), async (req, res) => {
  const payload = normalizeTemperaturePayload(req.validated.body, req.user);
  const insertResult = await insertRecordWithOptionalScope(supabase, 'temperature_logs', payload, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  res.json(insertResult.data);
});

module.exports = router;
