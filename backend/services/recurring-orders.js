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

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function scopedRouteQuery(routeId, template) {
  let query = supabase.from('routes').select('id, stop_ids, active_stop_ids').eq('id', routeId);
  if (template.company_id) query = query.eq('company_id', template.company_id);
  return query;
}

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

async function appendStopToRoute(routeId, stopId, template) {
  if (!routeId || !stopId) return;

  const { data: route, error: routeError } = await scopedRouteQuery(routeId, template).single();
  if (routeError || !route) {
    throw routeError || new Error('Route template not found for recurring order');
  }

  const stopIds = normalizeIdArray(route.stop_ids);
  const activeStopIds = normalizeIdArray(route.active_stop_ids);
  const normalizedStopId = String(stopId);
  const nextStopIds = stopIds.includes(normalizedStopId) ? stopIds : [...stopIds, normalizedStopId];
  const nextActiveStopIds = activeStopIds.includes(normalizedStopId) ? activeStopIds : [...activeStopIds, normalizedStopId];

  const { error: updateError } = await supabase
    .from('routes')
    .update({ stop_ids: nextStopIds, active_stop_ids: nextActiveStopIds })
    .eq('id', routeId);
  if (updateError) throw updateError;
}

async function removeStopFromRoute(routeId, stopId) {
  if (!routeId || !stopId) return;
  const { data: route } = await supabase
    .from('routes')
    .select('id, stop_ids, active_stop_ids')
    .eq('id', routeId)
    .single();
  if (!route) return;

  const normalizedStopId = String(stopId);
  await supabase
    .from('routes')
    .update({
      stop_ids: normalizeIdArray(route.stop_ids).filter((id) => id !== normalizedStopId),
      active_stop_ids: normalizeIdArray(route.active_stop_ids).filter((id) => id !== normalizedStopId),
    })
    .eq('id', routeId);
}

async function deleteGeneratedArtifacts(orderId, stopId, routeId) {
  if (stopId) {
    await removeStopFromRoute(routeId, stopId);
    await supabase.from('stops').delete().eq('id', stopId);
  }
  if (orderId) {
    await supabase.from('orders').delete().eq('id', orderId);
  }
}

async function createStopForGeneratedOrder(record, template, orderId) {
  const routeId = record.route_id;
  const name = String(record.customer_name || '').trim();
  const address = String(record.customer_address || '').trim();
  if (!routeId || !name || !address) return null;

  const stopPayload = {
    name,
    address,
    lat: 0,
    lng: 0,
    notes: `Order ${record.order_number || orderId}`,
    route_id: routeId,
    company_id: record.company_id,
    location_id: record.location_id,
  };

  const { data: stop, error: stopError } = await supabase
    .from('stops')
    .insert([stopPayload])
    .select('id')
    .single();
  if (stopError) throw stopError;

  try {
    await appendStopToRoute(routeId, stop.id, template);

    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update({ stop_id: stop.id })
      .eq('id', orderId);
    if (orderUpdateError) throw orderUpdateError;
  } catch (error) {
    await removeStopFromRoute(routeId, stop.id);
    await supabase.from('stops').delete().eq('id', stop.id);
    throw error;
  }

  return stop.id;
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

  let stopId = null;
  try {
    stopId = await createStopForGeneratedOrder(record, template, data.id);
  } catch (error) {
    await deleteGeneratedArtifacts(data.id, stopId, record.route_id);
    throw error;
  }

  return { created: true, orderId: data.id, orderNumber: data.order_number, stopId };
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
