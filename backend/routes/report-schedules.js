'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../lib/zod-validate');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');
const { runReportSchedule } = require('../services/report-scheduler');
const { getReportDefinitionCatalog } = require('../services/report-exporter');

const router = express.Router();
const reportRoles = requireRole('admin', 'manager');

const deliveryTargetSchema = z.object({
  target_type: z.enum(['email', 'download']),
  address: z.string().trim().email().optional().or(z.literal('')),
}).superRefine((value, ctx) => {
  if (value.target_type === 'email' && !value.address) {
    ctx.addIssue({ code: 'custom', path: ['address'], message: 'Email delivery requires an address' });
  }
});

const cadenceConfigSchema = z.object({
  time: z.string().trim().regex(/^\d{1,2}:\d{2}$/).default('08:00'),
  day_of_week: z.number().int().min(0).max(6).optional(),
  day_of_month: z.number().int().min(1).max(31).optional(),
  format: z.enum(['csv', 'text', 'txt', 'pdf', 'excel', 'xlsx']).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const scheduleBodySchema = z.object({
  report_definition_id: z.string().trim().min(1),
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  cadence_config: cadenceConfigSchema.optional().default({ time: '08:00' }),
  delivery_targets: z.array(deliveryTargetSchema).max(20).optional().default([]),
  is_active: z.boolean().optional().default(true),
  next_run_at: z.string().datetime().optional().nullable(),
});

const schedulePatchSchema = scheduleBodySchema.partial().extend({
  is_active: z.boolean().optional(),
});

function firstRow(resultRows, context) {
  return filterRowsByContext(resultRows || [], context)[0] || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeQueryKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

async function resolveReportDefinitionId(req, rawDefinitionId) {
  if (isUuid(rawDefinitionId)) {
    const { data, error } = await scopeQueryByContext(
      supabase.from('report_definitions').select('*'),
      req.context,
      { companyField: 'company_id', includeLocation: true },
    ).eq('id', rawDefinitionId).limit(1);
    if (error) throw error;
    const existingById = firstRow(data, req.context);
    if (existingById) return existingById.id;
  }

  const requestedKey = normalizeQueryKey(rawDefinitionId);
  const { data: existingRows, error: existingError } = await scopeQueryByContext(
    supabase.from('report_definitions').select('*'),
    req.context,
    { companyField: 'company_id', includeLocation: true },
  ).eq('query_key', requestedKey).limit(1);
  if (existingError) throw existingError;
  const existingByKey = firstRow(existingRows, req.context);
  if (existingByKey) return existingByKey.id;

  const catalogDefinition = getReportDefinitionCatalog().find((definition) => definition.query_key === requestedKey);
  if (!catalogDefinition) {
    const error = new Error('Report definition not found');
    error.status = 400;
    throw error;
  }

  const result = await insertRecordWithOptionalScope(supabase, 'report_definitions', {
    name: catalogDefinition.name,
    category: catalogDefinition.category,
    description: catalogDefinition.description,
    query_key: catalogDefinition.query_key,
    parameters: {},
    is_system: true,
  }, req.context);
  if (result.error) throw result.error;
  return (result.data || result.appliedRecord).id;
}

async function loadSchedule(req, id) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('report_schedules').select('*'),
    req.context,
    { companyField: 'company_id', includeLocation: true },
  ).eq('id', id).limit(1);
  if (error) throw error;
  return firstRow(data, req.context);
}

router.get('/', authenticateToken, reportRoles, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('report_schedules').select('*').order('created_at', { ascending: false }),
      req.context,
      { companyField: 'company_id', includeLocation: true },
    ).limit(500);
    if (error) throw error;
    res.json({ schedules: filterRowsByContext(data || [], req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load report schedules' });
  }
});

router.post('/', authenticateToken, reportRoles, validateBody(scheduleBodySchema), async (req, res) => {
  try {
    const reportDefinitionId = await resolveReportDefinitionId(req, req.validated.body.report_definition_id);
    const payload = {
      ...req.validated.body,
      report_definition_id: reportDefinitionId,
      created_by: req.user.id,
      updated_at: new Date().toISOString(),
    };
    const result = await insertRecordWithOptionalScope(supabase, 'report_schedules', payload, req.context);
    if (result.error) throw result.error;
    res.status(201).json(result.data || result.appliedRecord);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to create report schedule' });
  }
});

router.get('/:id/runs', authenticateToken, reportRoles, async (req, res) => {
  try {
    const schedule = await loadSchedule(req, req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Report schedule not found' });
    const { data, error } = await scopeQueryByContext(
      supabase.from('report_runs').select('*').order('created_at', { ascending: false }),
      req.context,
      { companyField: 'company_id', includeLocation: true },
    ).eq('report_schedule_id', schedule.id).limit(100);
    if (error) throw error;
    res.json({ runs: filterRowsByContext(data || [], req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load report runs' });
  }
});

router.post('/:id/run-now', authenticateToken, reportRoles, async (req, res) => {
  try {
    const schedule = await loadSchedule(req, req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Report schedule not found' });
    const run = await runReportSchedule(schedule.id, {
      force: true,
      context: req.context,
    });
    res.status(run.idempotent ? 200 : 201).json(run);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to run report schedule' });
  }
});

router.get('/:id', authenticateToken, reportRoles, async (req, res) => {
  try {
    const schedule = await loadSchedule(req, req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Report schedule not found' });
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load report schedule' });
  }
});

router.patch('/:id', authenticateToken, reportRoles, validateBody(schedulePatchSchema), async (req, res) => {
  try {
    const existing = await loadSchedule(req, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Report schedule not found' });
    const result = await scopeQueryByContext(
      supabase.from('report_schedules').update({
        ...req.validated.body,
        updated_at: new Date().toISOString(),
      }),
      req.context,
      { companyField: 'company_id', includeLocation: true },
    ).eq('id', existing.id).select().single();
    if (result.error) throw result.error;
    res.json(result.data || { ...existing, ...req.validated.body });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update report schedule' });
  }
});

router.delete('/:id', authenticateToken, reportRoles, async (req, res) => {
  try {
    const existing = await loadSchedule(req, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Report schedule not found' });
    const result = await scopeQueryByContext(
      supabase.from('report_schedules').update({ is_active: false, updated_at: new Date().toISOString() }),
      req.context,
      { companyField: 'company_id', includeLocation: true },
    ).eq('id', existing.id).select().single();
    if (result.error) throw result.error;
    res.json(result.data || { ...existing, is_active: false });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete report schedule' });
  }
});

module.exports = router;
