'use strict';

/**
 * Scheduler
 * ─────────
 * Uses node-cron to fire background jobs on a schedule.
 * Started once from server.js after the server begins listening.
 *
 * Jobs:
 *   - Daily Fish Blast: 6:30 AM Eastern, Mon–Sat
 */

let cron;
try {
  cron = require('node-cron');
} catch {
  cron = null;
}

const logger = require('../services/logger');
const { runDailyFishBlastForAllCompanies } = require('../services/daily-fish-blast');
const creditEngine = require('../services/creditEngine');
const config = require('./config');

// 6:30 AM Eastern = 10:30 UTC (EST) / 11:30 UTC (EDT)
// Use TZ option to let node-cron handle the offset correctly.
const BLAST_CRON = process.env.DAILY_BLAST_CRON || '30 6 * * 1-6';
const BLAST_TZ   = 'America/New_York';

// 5:00 AM Eastern, every day — full credit recheck for all customers.
const CREDIT_CHECK_CRON = process.env.CREDIT_CHECK_CRON || '0 5 * * *';
// 6:00 AM Eastern, Sundays — weekly AR aging digest to AR managers.
const AR_AGING_DIGEST_CRON = process.env.AR_AGING_DIGEST_CRON || '0 6 * * 0';
const CREDIT_TZ = 'America/New_York';

function startScheduler() {
  if (!cron) {
    logger.warn('node-cron is not installed — scheduled jobs will not run. Run: npm install node-cron');
    return;
  }

  if (!cron.validate(BLAST_CRON)) {
    logger.error({ cron: BLAST_CRON }, 'DAILY_BLAST_CRON is not a valid cron expression — scheduler not started');
    return;
  }

  cron.schedule(BLAST_CRON, async () => {
    try {
      const companyName = process.env.COMPANY_NAME || '';
      await runDailyFishBlastForAllCompanies(companyName);
    } catch (err) {
      logger.error({ err }, 'Daily fish blast: unhandled error');
    }
  }, { timezone: BLAST_TZ });

  // Daily full credit check — recompute balances, place/release holds, log events.
  if (cron.validate(CREDIT_CHECK_CRON)) {
    cron.schedule(CREDIT_CHECK_CRON, async () => {
      try {
        await creditEngine.runScheduledCreditCheck();
      } catch (err) {
        logger.error({ err }, 'Scheduled credit check: unhandled error');
      }
    }, { timezone: CREDIT_TZ });
  } else {
    logger.error({ cron: CREDIT_CHECK_CRON }, 'CREDIT_CHECK_CRON invalid — credit job not scheduled');
  }

  // Weekly AR aging digest — pushes a summary email to admin/AR managers.
  if (cron.validate(AR_AGING_DIGEST_CRON)) {
    cron.schedule(AR_AGING_DIGEST_CRON, async () => {
      try {
        await sendWeeklyArAgingDigest();
      } catch (err) {
        logger.error({ err }, 'Weekly AR aging digest: unhandled error');
      }
    }, { timezone: CREDIT_TZ });
  } else {
    logger.error({ cron: AR_AGING_DIGEST_CRON }, 'AR_AGING_DIGEST_CRON invalid — digest job not scheduled');
  }

  logger.info({
    blast: BLAST_CRON,
    creditCheck: CREDIT_CHECK_CRON,
    arDigest: AR_AGING_DIGEST_CRON,
    tz: CREDIT_TZ,
  }, 'Scheduler started');
}

async function sendWeeklyArAgingDigest() {
  const { supabase } = require('../services/supabase');
  const { createMailer } = require('../services/email');

  const { data: openInvoices } = await supabase
    .from('invoices')
    .select('id, customer_name, total, due_date, created_at, status')
    .in('status', creditEngine.OPEN_INVOICE_STATUSES);

  const buckets = { Current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const now = Date.now();
  (openInvoices || []).forEach((inv) => {
    const due = inv.due_date || inv.created_at;
    if (!due) return;
    const days = Math.floor((now - new Date(due).getTime()) / 86_400_000);
    const total = parseFloat(inv.total) || 0;
    if (days <= 0) buckets.Current += total;
    else if (days <= 30) buckets['1-30'] += total;
    else if (days <= 60) buckets['31-60'] += total;
    else if (days <= 90) buckets['61-90'] += total;
    else buckets['90+'] += total;
  });

  const { data: arUsers } = await supabase
    .from('users')
    .select('email, role')
    .in('role', ['admin', 'manager']);
  const recipients = [...new Set((arUsers || []).map((u) => u.email).filter(Boolean))];
  if (!recipients.length) return;

  const mailer = createMailer();
  if (!mailer) return;

  const lines = Object.entries(buckets).map(([k, v]) => `  ${k}: $${v.toFixed(2)}`);
  const body = [
    'Weekly AR Aging Digest',
    '',
    'Outstanding balances by age bucket:',
    ...lines,
    '',
    `Total open invoices: ${(openInvoices || []).length}`,
  ].join('\n');

  try {
    await mailer.sendMail({
      to: recipients,
      subject: `Weekly AR Aging Digest — ${new Date().toISOString().slice(0, 10)}`,
      text: body,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'AR aging digest send failed');
  }
}

module.exports = { startScheduler };
