'use strict';

const logger = require('./logger');
const { maskPhone, sendSms } = require('./sms');
const { buildTrackingUrlFromBase } = require('../lib/tracking-url');
const { getMedianDwellMs } = require('./dwell-stats');

const NOTIFY_AT_STOPS_AWAY = Math.max(1, Number(process.env.DELIVERY_NOTIFY_STOPS_AWAY) || 3);
// Per-phone send cap (per rolling hour) — guards against notification storms.
const SMS_RATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.SMS_RATE_LIMIT_PER_HOUR) || 6);

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

function extractOrderNumberFromStop(stop) {
  const match = String(stop?.notes || '').match(/\bOrder\s+([A-Za-z0-9-]+)/i);
  return match ? match[1] : null;
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

async function first(queryResult) {
  const result = await queryResult;
  if (result?.error) return null;
  if (Array.isArray(result?.data)) return result.data[0] || null;
  return result?.data || null;
}

async function loadStop(client, stopId) {
  if (!stopId) return null;
  return first(client.from('stops').select('*').eq('id', stopId).limit(1));
}

async function loadOrderForStop(client, stop) {
  if (!stop) return null;

  const byStopId = await first(client.from('orders').select('*').eq('stop_id', stop.id).limit(1));
  if (byStopId) return byStopId;

  const orderNumber = extractOrderNumberFromStop(stop);
  if (orderNumber) {
    const byNumber = await first(client.from('orders').select('*').eq('order_number', orderNumber).limit(1));
    if (byNumber) return byNumber;
  }

  if (stop.invoice_id) {
    const byInvoice = await first(client.from('orders').select('*').eq('invoice_id', stop.invoice_id).limit(1));
    if (byInvoice) return byInvoice;
  }

  return null;
}

async function loadOrder(client, orderIdOrInvoiceId) {
  if (!orderIdOrInvoiceId) return null;
  const byId = await first(client.from('orders').select('*').eq('id', orderIdOrInvoiceId).limit(1));
  if (byId) return byId;
  return first(client.from('orders').select('*').eq('invoice_id', orderIdOrInvoiceId).limit(1));
}

// ── Outbound message log, preference, de-dup, rate limit ───────────────────
// All helpers are defensive: if the outbound_messages table or the Customers
// preference column is unavailable, sends degrade to the legacy behaviour
// instead of throwing.

async function logOutboundMessage(client, entry) {
  try {
    const { error } = await client.from('outbound_messages').insert([{
      company_id: entry.companyId ?? null,
      order_id: entry.orderId ?? null,
      stop_id: entry.stopId ?? null,
      event: entry.event,
      channel: 'sms',
      phone: entry.phone ?? null,
      body: entry.body ?? null,
      status: entry.status,
      provider_sid: entry.sid ?? null,
      error: entry.error ?? null,
    }]);
    if (error) logger.warn({ event: entry.event, error: error.message }, 'Outbound message log insert failed');
  } catch (error) {
    logger.warn({ event: entry.event, error: error?.message || String(error) }, 'Outbound message log unavailable');
  }
}

async function alreadySentEvent(client, event, { stopId, orderId }) {
  try {
    let query = client
      .from('outbound_messages')
      .select('id,status')
      .eq('event', event)
      .in('status', ['sent', 'dry_run'])
      .limit(1);
    if (stopId) query = query.eq('stop_id', stopId);
    else if (orderId) query = query.eq('order_id', orderId);
    else return false;
    const { data } = await query;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function isRateLimited(client, phone) {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data } = await client
      .from('outbound_messages')
      .select('id')
      .eq('phone', phone)
      .in('status', ['sent', 'dry_run'])
      .gte('created_at', since)
      .limit(SMS_RATE_LIMIT_PER_HOUR);
    return Array.isArray(data) && data.length >= SMS_RATE_LIMIT_PER_HOUR;
  } catch {
    return false;
  }
}

async function smsPreferenceAllowed(client, order) {
  if (!order) return true;
  try {
    let customer = null;
    if (order.customer_id) {
      customer = await first(client.from('Customers').select('id,sms_notifications_enabled').eq('id', order.customer_id).limit(1));
    }
    if (!customer && order.customer_phone) {
      customer = await first(client.from('Customers').select('id,sms_notifications_enabled').eq('phone', order.customer_phone).limit(1));
    }
    if (!customer && order.customer_email) {
      customer = await first(client.from('Customers').select('id,sms_notifications_enabled').eq('email', order.customer_email).limit(1));
    }
    // Default allow: only an explicit opt-out blocks the send.
    return customer?.sms_notifications_enabled !== false;
  } catch {
    return true;
  }
}

async function sendEventSms(client, { event, order, stopId, body, metadata = {} }) {
  const logBase = {
    event,
    companyId: order?.company_id || metadata.companyId || null,
    orderId: order?.id || metadata.orderId || null,
    stopId: stopId || null,
    body,
  };

  const phone = normalizePhone(order?.customer_phone ?? metadata.phone);
  if (!phone) {
    logger.info({ ...metadata, event, reason: 'missing_phone' }, 'Delivery SMS skipped');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }
  const phoneForLog = maskPhone(phone);

  if (!(await smsPreferenceAllowed(client, order))) {
    logger.info({ ...metadata, event, phone: phoneForLog, reason: 'sms_notifications_disabled' }, 'Delivery SMS skipped');
    await logOutboundMessage(client, { ...logBase, phone, status: 'skipped', error: 'sms_notifications_disabled' });
    return { sent: false, skipped: true, reason: 'sms_notifications_disabled' };
  }

  if (await alreadySentEvent(client, event, { stopId, orderId: order?.id || metadata.orderId })) {
    logger.info({ ...metadata, event, phone: phoneForLog, reason: 'duplicate_event' }, 'Delivery SMS skipped (already sent)');
    return { sent: false, skipped: true, reason: 'duplicate_event' };
  }

  if (await isRateLimited(client, phone)) {
    logger.warn({ ...metadata, event, phone: phoneForLog, reason: 'rate_limited' }, 'Delivery SMS skipped (rate limit)');
    await logOutboundMessage(client, { ...logBase, phone, status: 'skipped', error: 'rate_limited' });
    return { sent: false, skipped: true, reason: 'rate_limited' };
  }

  try {
    const result = await sendSms(phone, body);
    if (result?.success) {
      logger.info({ ...metadata, event, phone: phoneForLog, sid: result.sid }, 'Delivery SMS sent');
      await logOutboundMessage(client, { ...logBase, phone, status: result.dryRun ? 'dry_run' : 'sent', sid: result.sid || null });
      return { sent: true, phone, sid: result.sid || null };
    }
    logger.warn({ ...metadata, event, phone: phoneForLog, error: result?.error || 'unknown_error' }, 'Delivery SMS failed');
    await logOutboundMessage(client, { ...logBase, phone, status: 'failed', error: result?.error || 'unknown_error' });
    return { sent: false, phone, error: result?.error || 'unknown_error' };
  } catch (error) {
    logger.warn({ ...metadata, event, phone: phoneForLog, error: error?.message || String(error) }, 'Delivery SMS threw');
    await logOutboundMessage(client, { ...logBase, phone, status: 'failed', error: error?.message || String(error) });
    return { sent: false, phone, error: error?.message || String(error) };
  }
}

async function notifyRouteDispatched(client, routeId, trackingBaseUrl) {
  try {
    if (!routeId) return { sent: 0, skipped: true, reason: 'missing_route_id' };
    const route = await first(client.from('routes').select('id, stop_ids, active_stop_ids').eq('id', routeId).limit(1));
    const routeStopIds = normalizeIdArray(route?.active_stop_ids).length
      ? normalizeIdArray(route.active_stop_ids)
      : normalizeIdArray(route?.stop_ids);
    if (!routeStopIds.length) {
      return { sent: 0, skipped: true, reason: 'empty_route_queue' };
    }

    const { data: orders, error } = await client
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, tracking_token, stop_id, status')
      .in('stop_id', routeStopIds);
    if (error || !Array.isArray(orders) || !orders.length) {
      return { sent: 0, skipped: true, reason: error?.message || 'no_orders' };
    }

    const results = [];
    for (const order of orders) {
      if (['cancelled', 'completed', 'delivered', 'invoiced'].includes(String(order.status || '').toLowerCase())) {
        results.push({ sent: false, skipped: true, reason: 'inactive_order_status', orderId: order.id });
        continue;
      }
      if (!order.tracking_token) {
        results.push({ sent: false, skipped: true, reason: 'missing_tracking_token', orderId: order.id });
        continue;
      }
      const trackingUrl = buildTrackingUrlFromBase(trackingBaseUrl, order.tracking_token);
      const body = `Hi ${order.customer_name || 'there'}, your delivery is on the way. Track your driver live: ${trackingUrl}`;
      const result = await sendEventSms(client, {
        event: 'route_dispatched',
        order,
        stopId: order.stop_id || null,
        body,
        metadata: { routeId },
      });
      results.push({ ...result, orderId: order.id });
    }
    return { sent: results.filter((result) => result.sent).length, results };
  } catch (error) {
    logger.warn({ routeId, error: error?.message || String(error) }, 'Delivery dispatch SMS failed');
    return { sent: 0, error: error?.message || String(error) };
  }
}

async function notifyDriverArriving(client, stopId, routeId) {
  try {
    const stop = await loadStop(client, stopId);
    const order = await loadOrderForStop(client, stop);
    const body = `Your NodeRoute driver is arriving now at ${stop?.address || 'your stop'}. Please be ready to receive your delivery.`;
    return sendEventSms(client, {
      event: 'driver_arriving',
      order,
      stopId,
      body,
      metadata: { routeId },
    });
  } catch (error) {
    logger.warn({ stopId, routeId, error: error?.message || String(error) }, 'Delivery arrival SMS failed');
    return { sent: false, error: error?.message || String(error) };
  }
}

async function notifyDeliveryCompleted(client, stopId, orderId, context = {}) {
  try {
    const stop = await loadStop(client, stopId);
    const order = (await loadOrderForStop(client, stop)) || (await loadOrder(client, orderId));
    // Include a link to the proof-of-delivery (the tracking page shows the
    // delivered status timeline + POD photo once the stop is completed).
    let body = 'Your NodeRoute delivery has been completed. Thank you!';
    if (order?.tracking_token) {
      const trackingBaseUrl = context?.trackingBaseUrl || context?.tracking_base_url || process.env.BASE_URL || 'http://localhost:3001';
      const podUrl = buildTrackingUrlFromBase(trackingBaseUrl, order.tracking_token);
      body = `Your NodeRoute delivery has been completed. View your proof of delivery: ${podUrl}`;
    }
    return sendEventSms(client, {
      event: 'delivery_completed',
      order,
      stopId,
      body,
      metadata: { orderId: order?.id || orderId || null },
    });
  } catch (error) {
    logger.warn({ stopId, orderId, error: error?.message || String(error) }, 'Delivery completion SMS failed');
    return { sent: false, error: error?.message || String(error) };
  }
}

async function notifyUpcomingStops(client, routeId, completedStopId, context = {}) {
  try {
    if (!routeId) return { sent: false, skipped: true, reason: 'missing_route_id' };

    const route = await first(client.from('routes').select('*').eq('id', routeId).limit(1));
    const activeStopIds = Array.isArray(route?.active_stop_ids) && route.active_stop_ids.length
      ? route.active_stop_ids
      : (Array.isArray(route?.stop_ids) ? route.stop_ids : []);
    if (!activeStopIds.length) {
      return { sent: false, skipped: true, reason: 'empty_route_queue' };
    }

    const { data: stops, error: stopsError } = await client
      .from('stops')
      .select('*')
      .in('id', activeStopIds);
    if (stopsError) throw stopsError;

    const stopMap = new Map((stops || []).map((stop) => [String(stop.id), stop]));
    const remainingQueue = activeStopIds
      .map((id) => stopMap.get(String(id)))
      .filter(Boolean)
      .filter((stop) => !['completed', 'arrived'].includes(String(stop.status || '').toLowerCase()));

    const targetStop = remainingQueue[NOTIFY_AT_STOPS_AWAY - 1] || null;
    if (!targetStop) {
      return { sent: false, skipped: true, reason: 'no_stop_at_notify_position' };
    }
    if (targetStop.proximity_notified_at) {
      return { sent: false, skipped: true, reason: 'already_notified', stopId: targetStop.id };
    }

    const order = await loadOrderForStop(client, targetStop);
    if (!order?.tracking_token) {
      return { sent: false, skipped: true, reason: 'missing_tracking_token', stopId: targetStop.id };
    }

    const medianStopMs = await getMedianDwellMs(client, context);
    const medianStopMinutes = Math.max(1, Math.round((medianStopMs / 60000) * NOTIFY_AT_STOPS_AWAY));
    const trackingBaseUrl = context?.trackingBaseUrl || context?.tracking_base_url || process.env.BASE_URL || 'http://localhost:3001';
    const trackingUrl = buildTrackingUrlFromBase(trackingBaseUrl, order.tracking_token);
    const body = `Hi ${order.customer_name || 'there'}, your NodeRoute driver is ${NOTIFY_AT_STOPS_AWAY} stops away and heading to you. Estimated arrival: ~${medianStopMinutes} minutes. Track live: ${trackingUrl}`;

    const result = await sendEventSms(client, {
      event: 'upcoming_stop',
      order,
      stopId: targetStop.id,
      body,
      metadata: { routeId, completedStopId },
    });

    if (result.sent) {
      const { error: updateError } = await client
        .from('stops')
        .update({ proximity_notified_at: new Date().toISOString() })
        .eq('id', targetStop.id);
      if (updateError) {
        logger.warn({ routeId, stopId: targetStop.id, error: updateError.message }, 'Delivery proximity SMS idempotency update failed');
      }
    }

    return { ...result, stopId: targetStop.id, orderId: order.id };
  } catch (error) {
    logger.warn({ routeId, completedStopId, error: error?.message || String(error) }, 'Delivery proximity SMS failed');
    return { sent: false, error: error?.message || String(error) };
  }
}

module.exports = {
  notifyRouteDispatched,
  notifyDriverArriving,
  notifyDeliveryCompleted,
  notifyUpcomingStops,
  normalizePhone,
  NOTIFY_AT_STOPS_AWAY,
};
