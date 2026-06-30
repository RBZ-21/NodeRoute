'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}report-scheduler.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}report-exporter.js`)
    ) {
      delete require.cache[key];
    }
  }
}

async function withReportScheduler(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-report-schedules-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const scheduler = require('../services/report-scheduler');
    const context = { companyId: 'company-report-a', locationId: 'location-report-a' };
    await supabase.from('report_definitions').insert({
      id: 'report-definition-1',
      company_id: 'company-report-a',
      location_id: 'location-report-a',
      name: 'Invoice Register',
      query_key: 'invoice_register',
      parameters: {},
      is_system: true,
    });
    await fn({ supabase, scheduler, context });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('report scheduler run_key uniqueness prevents duplicate scheduled runs', async () => {
  await withReportScheduler(async ({ supabase, scheduler, context }) => {
    await supabase.from('report_schedules').insert({
      id: 'schedule-daily-1',
      company_id: 'company-report-a',
      location_id: 'location-report-a',
      report_definition_id: 'report-definition-1',
      cadence: 'daily',
      cadence_config: { time: '08:00' },
      delivery_targets: [{ target_type: 'download' }],
      is_active: true,
      next_run_at: '2026-06-29T08:00:00.000Z',
      created_by: 'scheduler-user',
    });

    const first = await scheduler.runDueReportSchedules('company-report-a', {
      db: supabase,
      context,
      now: new Date('2026-06-29T09:00:00.000Z'),
    });
    const second = await scheduler.runDueReportSchedules('company-report-a', {
      db: supabase,
      context,
      now: new Date('2026-06-29T09:05:00.000Z'),
    });

    assert.equal(first.triggered, 1);
    assert.equal(second.triggered, 0);

    const { data: runs } = await supabase.from('report_runs').select('*').eq('report_schedule_id', 'schedule-daily-1');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].run_key, 'schedule-daily-1:2026-06-29');
  });
});

test('inactive report schedules are not triggered by the due scheduler', async () => {
  await withReportScheduler(async ({ supabase, scheduler, context }) => {
    await supabase.from('report_schedules').insert({
      id: 'schedule-inactive-1',
      company_id: 'company-report-a',
      location_id: 'location-report-a',
      report_definition_id: 'report-definition-1',
      cadence: 'daily',
      cadence_config: { time: '08:00' },
      delivery_targets: [{ target_type: 'download' }],
      is_active: false,
      next_run_at: '2026-06-29T08:00:00.000Z',
    });

    const result = await scheduler.runDueReportSchedules('company-report-a', {
      db: supabase,
      context,
      now: new Date('2026-06-29T09:00:00.000Z'),
    });

    assert.equal(result.triggered, 0);
    const { data: runs } = await supabase.from('report_runs').select('*').eq('report_schedule_id', 'schedule-inactive-1');
    assert.equal(runs.length, 0);
  });
});

test('run-now inserts an immediate run record even when cadence is not due', async () => {
  await withReportScheduler(async ({ supabase, scheduler, context }) => {
    await supabase.from('report_schedules').insert({
      id: 'schedule-now-1',
      company_id: 'company-report-a',
      location_id: 'location-report-a',
      report_definition_id: 'report-definition-1',
      cadence: 'weekly',
      cadence_config: { time: '08:00', day_of_week: 1 },
      delivery_targets: [{ target_type: 'download' }],
      is_active: true,
      next_run_at: '2026-07-06T08:00:00.000Z',
    });

    const run = await scheduler.runReportSchedule('schedule-now-1', {
      db: supabase,
      context,
      force: true,
      now: new Date('2026-06-29T09:00:00.000Z'),
    });

    assert.equal(run.status, 'delivered');
    assert.equal(run.report_schedule_id, 'schedule-now-1');
    assert.match(run.run_key, /^schedule-now-1:2026-06-29/);
  });
});
