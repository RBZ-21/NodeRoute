'use strict';

const { supabase: defaultDb } = require('./supabase');
const { createMailer } = require('./email');
const { exportReport } = require('./report-exporter');

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function dateKey(value) {
  return normalizeDate(value).toISOString().slice(0, 10);
}

function periodStartForSchedule(_schedule, now = new Date()) {
  return dateKey(now);
}

function buildRunKey(scheduleId, periodStart) {
  return `${scheduleId}:${periodStart}`;
}

function nextRunAt(schedule, now = new Date()) {
  const next = new Date(now);
  const config = schedule.cadence_config || {};
  if (schedule.cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else if (schedule.cadence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + 1);

  const time = String(config.time || '08:00').match(/^(\d{1,2}):(\d{2})/);
  if (time) {
    next.setUTCHours(Math.max(0, Math.min(23, Number(time[1]))), Math.max(0, Math.min(59, Number(time[2]))), 0, 0);
  }
  return next.toISOString();
}

function isDue(schedule, now = new Date()) {
  if (schedule.is_active === false) return false;
  if (!schedule.next_run_at) return true;
  return new Date(schedule.next_run_at).getTime() <= normalizeDate(now).getTime();
}

async function getSchedule(db, scheduleId, context = {}) {
  let query = db.from('report_schedules').select('*').eq('id', scheduleId).limit(1);
  if (context.activeCompanyId || context.companyId) {
    query = query.eq('company_id', context.activeCompanyId || context.companyId);
  }
  const { data, error } = await query;
  if (error) throw error;
  const schedule = Array.isArray(data) ? data[0] : data;
  if (!schedule) {
    const notFound = new Error('Report schedule not found');
    notFound.status = 404;
    throw notFound;
  }
  return schedule;
}

async function getDefinition(db, schedule) {
  const { data, error } = await db
    .from('report_definitions')
    .select('*')
    .eq('id', schedule.report_definition_id)
    .limit(1);
  if (error) throw error;
  const definition = Array.isArray(data) ? data[0] : data;
  if (!definition) {
    const notFound = new Error('Report definition not found');
    notFound.status = 404;
    throw notFound;
  }
  return definition;
}

async function existingRun(db, runKey) {
  const { data, error } = await db
    .from('report_runs')
    .select('*')
    .eq('run_key', runKey)
    .limit(1);
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
}

async function insertRun(db, schedule, runKey, periodStart) {
  const record = {
    company_id: schedule.company_id,
    location_id: schedule.location_id || null,
    report_schedule_id: schedule.id,
    run_key: runKey,
    period_start: periodStart,
    status: 'running',
    created_at: new Date().toISOString(),
  };
  const { data, error } = await db.from('report_runs').insert(record).select().single();
  if (error) throw error;
  return data || record;
}

async function updateRun(db, runId, fields) {
  const { data, error } = await db.from('report_runs').update(fields).eq('id', runId).select().single();
  if (error) throw error;
  return data || { id: runId, ...fields };
}

async function updateScheduleAfterRun(db, schedule, now = new Date()) {
  await db.from('report_schedules').update({
    last_run_at: normalizeDate(now).toISOString(),
    next_run_at: nextRunAt(schedule, now),
    updated_at: new Date().toISOString(),
  }).eq('id', schedule.id);
}

function parseTargets(schedule) {
  const raw = schedule.delivery_targets;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadTargets(db, schedule) {
  const jsonTargets = parseTargets(schedule);
  const { data } = await db
    .from('report_delivery_targets')
    .select('*')
    .eq('report_schedule_id', schedule.id)
    .limit(100);
  const tableTargets = Array.isArray(data) ? data.map((target) => ({
    target_type: target.target_type,
    address: target.address,
  })) : [];
  return [...jsonTargets, ...tableTargets].filter((target) => target && target.target_type);
}

async function deliverReport({ schedule, definition, exported, targets, mailer }) {
  const emailTargets = targets.filter((target) => target.target_type === 'email' && target.address);
  if (!emailTargets.length) return { delivered: true, mode: 'download' };

  const activeMailer = mailer || createMailer();
  if (!activeMailer) {
    const error = new Error('Report mailer is not configured');
    error.status = 503;
    throw error;
  }

  await activeMailer.sendMail({
    to: emailTargets.map((target) => target.address),
    subject: `NodeRoute report: ${definition.name}`,
    text: `${definition.name} is attached.`,
    attachments: [{
      filename: `${definition.query_key || 'report'}.${exported.extension}`,
      content: exported.buffer,
      contentType: exported.contentType,
    }],
    idempotencyKey: `report-run:${schedule.id}:${exported.query_key}`,
  });
  return { delivered: true, mode: 'email', recipient_count: emailTargets.length };
}

async function runReportSchedule(scheduleId, options = {}) {
  const db = options.db || defaultDb;
  const now = normalizeDate(options.now);
  const context = options.context || {};
  const schedule = await getSchedule(db, scheduleId, context);
  if (!options.force && !isDue(schedule, now)) {
    return { skipped: true, reason: 'not_due', report_schedule_id: schedule.id };
  }

  const periodStart = periodStartForSchedule(schedule, now);
  const runKey = buildRunKey(schedule.id, periodStart);
  const existing = await existingRun(db, runKey);
  if (existing) return { ...existing, idempotent: true };

  const run = await insertRun(db, schedule, runKey, periodStart);
  try {
    const definition = await getDefinition(db, schedule);
    const format = schedule.cadence_config?.format || definition.parameters?.format || 'csv';
    const params = { ...(definition.parameters || {}), ...(schedule.cadence_config?.params || {}) };
    const exported = await exportReport(definition.query_key, schedule.company_id, params, format, { db });
    const targets = await loadTargets(db, schedule);
    await deliverReport({ schedule, definition, exported, targets, mailer: options.mailer });
    const delivered = await updateRun(db, run.id, {
      status: 'delivered',
      delivered_at: now.toISOString(),
      error: null,
    });
    await updateScheduleAfterRun(db, schedule, now);
    return delivered;
  } catch (error) {
    await updateRun(db, run.id, {
      status: 'failed',
      error: error.message || 'Report run failed',
    });
    throw error;
  }
}

async function runDueReportSchedules(companyId, options = {}) {
  const db = options.db || defaultDb;
  const now = normalizeDate(options.now);
  const context = options.context || { companyId, activeCompanyId: companyId };
  let query = db.from('report_schedules').select('*').eq('is_active', true);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw error;

  let triggered = 0;
  let skipped = 0;
  const runs = [];
  for (const schedule of Array.isArray(data) ? data : []) {
    if (!isDue(schedule, now)) {
      skipped += 1;
      continue;
    }
    const run = await runReportSchedule(schedule.id, { ...options, db, context, now });
    if (run.idempotent || run.skipped) skipped += 1;
    else triggered += 1;
    runs.push(run);
  }
  return { triggered, skipped, runs };
}

async function runDueReportSchedulesForAllCompanies(options = {}) {
  const db = options.db || defaultDb;
  const { data, error } = await db.from('companies').select('id,status').limit(1000);
  if (error) throw error;
  const companies = Array.isArray(data) ? data.filter((company) => company.id && (!company.status || company.status === 'active')) : [];
  const results = [];
  for (const company of companies) {
    results.push({
      company_id: company.id,
      ...(await runDueReportSchedules(company.id, {
        ...options,
        db,
        context: { companyId: company.id, activeCompanyId: company.id },
      })),
    });
  }
  return results;
}

module.exports = {
  buildRunKey,
  isDue,
  nextRunAt,
  periodStartForSchedule,
  runDueReportSchedules,
  runDueReportSchedulesForAllCompanies,
  runReportSchedule,
};
