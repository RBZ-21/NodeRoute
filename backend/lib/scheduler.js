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
const { runAiInsightsForAllCompanies } = require('../services/ai-insights');
const { runRecurringOrderGeneration } = require('../services/recurring-orders');
const { DEFAULT_CRON: COST_PRICE_UPDATE_CRON, registerCostPriceScheduler } = require('../services/cost-price-scheduler');
const creditEngine = require('../services/creditEngine');
const reorderEngine = require('../services/reorderEngine');
const { supabase } = require('../services/supabase');
const { createMailer } = require('../services/email');
const config = require('./config');

// 6:30 AM Eastern = 10:30 UTC (EST) / 11:30 UTC (EDT)
// Use TZ option to let node-cron handle the offset correctly.
const BLAST_CRON = process.env.DAILY_BLAST_CRON || '30 6 * * 1-6';
const BLAST_TZ   = 'America/New_York';
const REORDER_CHECK_CRON = process.env.REORDER_CHECK_CRON || '0 */4 * * *';
const REORDER_USAGE_CRON = process.env.REORDER_USAGE_CRON || '0 0 * * 0';
const REORDER_DIGEST_CRON = process.env.REORDER_DIGEST_CRON || '0 6 * * *';
// Proactive AI insights (anomalies, smart reorder, collections risk) — every 6 hours.
const AI_INSIGHTS_CRON = process.env.AI_INSIGHTS_CRON || '0 */6 * * *';
// Recurring (standing) order generation — 8:00 PM Eastern, the evening before.
const RECURRING_ORDERS_CRON = process.env.RECURRING_ORDERS_CRON || '0 20 * * *';

async function sendReorderDigest() {
  const mailer = createMailer();
  if (!mailer) {
    logger.warn('Reorder digest skipped: email is not configured');
    return { sent: false, reason: 'email_not_configured' };
  }

  const { data: suggestions, error } = await supabase
    .from('reorder_suggestions')
    .select('*')
    .eq('status', 'pending')
    .in('urgency', ['critical', 'urgent', 'scheduled'])
    .order('urgency', { ascending: true });
  if (error) throw error;
  const rows = suggestions || [];
  if (!rows.length) return { sent: false, reason: 'no_urgent_suggestions' };

  const productIds = [...new Set(rows.map((row) => row.product_id).filter(Boolean))];
  const vendorIds = [...new Set(rows.map((row) => row.vendor_id).filter(Boolean))];
  const productMap = new Map();
  const vendorMap = new Map();
  if (productIds.length) {
    const { data: products } = await supabase
      .from('products')
      .select('id,name,description,item_number,on_hand_qty,unit')
      .in('id', productIds);
    (products || []).forEach((product) => productMap.set(product.id, product));
  }
  if (vendorIds.length) {
    const { data: vendors } = await supabase
      .from('vendors')
      .select('id,name')
      .in('id', vendorIds);
    (vendors || []).forEach((vendor) => vendorMap.set(vendor.id, vendor));
  }
  const { data: admins } = await supabase
    .from('users')
    .select('email,role,status')
    .in('role', ['admin', 'manager'])
    .eq('status', 'active');
  const recipients = (admins || []).map((user) => user.email).filter(Boolean);
  if (!recipients.length && !process.env.EMAIL_FROM) return { sent: false, reason: 'no_recipients' };

  const tableRows = rows.map((row) => {
    const product = productMap.get(row.product_id) || {};
    const vendor = vendorMap.get(row.vendor_id) || {};
    const productName = product.name || product.description || row.product_id;
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #ddd">${productName}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${row.current_stock} ${row.suggested_unit || product.unit || ''}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${row.days_of_stock_remaining ?? 'N/A'}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${row.suggested_quantity} ${row.suggested_unit || ''}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${vendor.name || 'Unassigned'}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-transform:uppercase">${row.urgency}</td>
    </tr>`;
  }).join('');
  const criticalCount = rows.filter((row) => row.urgency === 'critical').length;
  const subject = `NodeRoute: ${rows.length} products need reordering today`;
  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: recipients.length ? recipients.join(',') : process.env.EMAIL_FROM,
    subject,
    html: `<div style="font-family:Arial,sans-serif;color:#111">
      <h2 style="margin:0 0 8px">NodeRoute Reorder Digest</h2>
      <p>${criticalCount} critical and ${rows.length - criticalCount} urgent/scheduled reorder suggestions need review.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #333">Product</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #333">Current stock</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #333">Days remaining</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #333">Suggested qty</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #333">Vendor</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #333">Urgency</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`,
  });
  return { sent: true, recipients: recipients.length || 1, suggestions: rows.length };
}

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
  for (const [name, expression] of Object.entries({
    REORDER_CHECK_CRON,
    REORDER_USAGE_CRON,
    REORDER_DIGEST_CRON,
  })) {
    if (!cron.validate(expression)) {
      logger.error({ name, cron: expression }, 'Reorder cron expression is invalid — scheduler not started');
      return;
    }
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

  cron.schedule(REORDER_CHECK_CRON, async () => {
    logger.info({ cron: REORDER_CHECK_CRON }, 'Reorder check job started');
    try {
      const result = await reorderEngine.runReorderCheck();
      logger.info(result, 'Reorder check job completed');
    } catch (err) {
      logger.error({ err }, 'Reorder check job failed');
    }
  }, { timezone: BLAST_TZ });

  cron.schedule(REORDER_USAGE_CRON, async () => {
    logger.info({ cron: REORDER_USAGE_CRON }, 'Reorder weekly usage recalculation started');
    try {
      const result = await reorderEngine.recalcAllUsage();
      logger.info(result, 'Reorder weekly usage recalculation completed');
    } catch (err) {
      logger.error({ err }, 'Reorder weekly usage recalculation failed');
    }
  }, { timezone: BLAST_TZ });

  cron.schedule(REORDER_DIGEST_CRON, async () => {
    logger.info({ cron: REORDER_DIGEST_CRON }, 'Reorder digest job started');
    try {
      const result = await sendReorderDigest();
      logger.info(result, 'Reorder digest job completed');
    } catch (err) {
      logger.error({ err }, 'Reorder digest job failed');
    }
  }, { timezone: BLAST_TZ });

  // Proactive AI insights — refreshes ai_insights per company; idempotent
  // (each run replaces the company's unacknowledged rows of the same type).
  if (cron.validate(AI_INSIGHTS_CRON)) {
    cron.schedule(AI_INSIGHTS_CRON, async () => {
      logger.info({ cron: AI_INSIGHTS_CRON }, 'AI insights job started');
      try {
        const result = await runAiInsightsForAllCompanies();
        logger.info({ companies: result.companies }, 'AI insights job completed');
      } catch (err) {
        logger.error({ err }, 'AI insights job failed');
      }
    }, { timezone: BLAST_TZ });
  } else {
    logger.error({ cron: AI_INSIGHTS_CRON }, 'AI_INSIGHTS_CRON invalid — AI insights job not scheduled');
  }

  // Recurring order generation — runs the evening before each delivery day.
  if (cron.validate(RECURRING_ORDERS_CRON)) {
    cron.schedule(RECURRING_ORDERS_CRON, async () => {
      logger.info({ cron: RECURRING_ORDERS_CRON }, 'Recurring order generation started');
      try {
        const result = await runRecurringOrderGeneration();
        logger.info(result, 'Recurring order generation completed');
      } catch (err) {
        logger.error({ err }, 'Recurring order generation failed');
      }
    }, { timezone: BLAST_TZ });
  } else {
    logger.error({ cron: RECURRING_ORDERS_CRON }, 'RECURRING_ORDERS_CRON invalid — recurring order job not scheduled');
  }

  registerCostPriceScheduler(cron, {
    log: logger,
    expression: COST_PRICE_UPDATE_CRON,
    timezone: BLAST_TZ,
  });

  logger.info({
    dailyFishBlast: BLAST_CRON,
    creditCheck: CREDIT_CHECK_CRON,
    arDigest: AR_AGING_DIGEST_CRON,
    reorderCheck: REORDER_CHECK_CRON,
    reorderUsage: REORDER_USAGE_CRON,
    reorderDigest: REORDER_DIGEST_CRON,
    aiInsights: AI_INSIGHTS_CRON,
    recurringOrders: RECURRING_ORDERS_CRON,
    costPriceUpdates: COST_PRICE_UPDATE_CRON,
    tz: BLAST_TZ,
  }, 'Scheduler started');
}

async function sendWeeklyArAgingDigest() {
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

module.exports = { startScheduler, sendReorderDigest };
