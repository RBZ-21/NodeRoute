'use strict';

/**
 * Recurring (standing) order generation.
 * ──────────────────────────────────────
 * Runs the evening before each scheduled delivery day and creates real orders
 * for every active recurring template whose schedule includes tomorrow. Each
 * generated order is pre-assigned to the linked route template if set.
 *
 * Idempotency: an order carries (recurring_order_id, recurring_run_date). The
 * generator checks for an existing order with that pair before inserting, and a
 * unique index enforces it under concurrency — so running the job twice for the
 * same day never creates duplicates.
 */

const logger = require('./logger');
const { supabase } = require('./supabase');

const DAY_MS = 86_400_000;

function toDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Next scheduled date (inclusive of today) given ISO weekday numbers (0=Sun).
function computeNextRunDate(scheduleDays, from = new Date()) {
  const days = (scheduleDays || []).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!days.length) return null;
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from.getTime() + offset * DAY_MS);
    if (days.includes(candidate.getUTCDay())) return toDateKey(candidate);
  }
  return null;
}

function generateOrderNumber() {
  return 'ORD-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random() * 90 + 10);
}

function trackingToken() {
  // 18 random bytes; falls back to a timestamp-based token if crypto is unavailable.
  try {
    return require('crypto').randomBytes(18).toString('hex');
  } catch {
    return `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

async function generateOrderForTemplate(template, runDateKey) {
  // De-dup guard: skip if an order already exists for this template + date.
  const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('recurring_order_id', template.id)
    .eq('recurring_run_date', runDateKey)
    .limit(1);
  if (Array.isArray(existing) && existing.length) {
    return { skipped: true, reason: 'already_generated' };
  }

  const record = {
    order_number: generateOrderNumber(),
    customer_name: template.customer_name,
    customer_email: template.customer_email || null,
    customer_address: template.customer_address || null,
    items: Array.isArray(template.items) ? template.items : [],
    charges: [],
    status: 'pending',
    source: 'recurring',
    notes: template.notes || null,
    route_id: template.route_template_id || null,
    company_id: template.company_id || null,
    location_id: template.location_id || null,
    recurring_order_id: template.id,
    recurring_run_date: runDateKey,
    tracking_token: trackingToken(),
  };

  const { data, error } = await supabase.from('orders').insert([record]).select('id,order_number').single();
  if (error) {
    // A unique-violation here means a concurrent run already created it.
    if (String(error.code) === '23505') return { skipped: true, reason: 'duplicate' };
    throw error;
  }
  return { created: true, orderId: data.id, orderNumber: data.order_number };
}

/**
 * Generate orders for all active recurring templates due on `targetDate`
 * (defaults to tomorrow — the job runs the evening before).
 */
async function runRecurringOrderGeneration(targetDate = new Date(Date.now() + DAY_MS)) {
  const runDateKey = toDateKey(targetDate);
  const weekday = new Date(targetDate).getUTCDay();

  const { data: templates, error } = await supabase
    .from('recurring_orders')
    .select('*')
    .eq('active', true);
  if (error) throw error;

  const due = (templates || []).filter((t) => Array.isArray(t.schedule_days) && t.schedule_days.map(Number).includes(weekday));

  let created = 0;
  let skipped = 0;
  for (const template of due) {
    try {
      const result = await generateOrderForTemplate(template, runDateKey);
      if (result.created) created += 1; else skipped += 1;

      // Advance next_run_date for display. Compute from the day after the run date.
      const nextRun = computeNextRunDate(template.schedule_days, new Date(targetDate.getTime() + DAY_MS));
      await supabase
        .from('recurring_orders')
        .update({ next_run_date: nextRun, last_generated_at: new Date().toISOString() })
        .eq('id', template.id);
    } catch (err) {
      logger.error({ err, templateId: template.id }, 'Recurring order generation failed for template');
    }
  }

  logger.info({ runDate: runDateKey, due: due.length, created, skipped }, 'Recurring order generation completed');
  return { runDate: runDateKey, due: due.length, created, skipped };
}

module.exports = {
  computeNextRunDate,
  generateOrderForTemplate,
  runRecurringOrderGeneration,
};
