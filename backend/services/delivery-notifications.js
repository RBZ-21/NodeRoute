'use strict';

const logger = require('./logger');
const { sendSms } = require('./sms');
const { buildTrackingUrlFromBase } = require('../lib/tracking-url');
const { getMedianDwellMs } = require('./dwell-stats');

const NOTIFY_AT_STOPS_AWAY = 2;

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

async function safeSendSms(to, body, metadata) {
  const phone = normalizePhone(to);
  if (!phone) {
    logger.info({ ...metadata, reason: 'missing_phone' }, 'Delivery SMS skipped');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  try {
    const result = await sendSms(phone, body);
    if (result?.success) {
      logger.info({ ...metadata, phone, sid: result.sid }, 'Delivery SMS sent');
      return { sent: true, phone, sid: result.sid || null };
    }
    logger.warn({ ...metadata, phone, error: result?.error || 'unknown_error' }, 'Delivery SMS failed');
    return { sent: false, phone, error: result?.error || 'unknown_error' };
  } catch (error) {
    logger.warn({ ...metadata, phone, error: error?.message || String(error) }, 'Delivery SMS threw');
    return { sent: false, phone, error: error?.message || String(error) };
  }
}

async function notifyRouteDispatched(client, routeId, trackingBaseUrl) {
  try {
    if (!routeId) return { sent: 0, skipped: true, reason: 'missing_route_id' };
    const { data: orders, error } = await client
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, tracking_token, stop_id')
      .eq('route_id', routeId);
    if (error || !Array.isArray(orders) || !orders.length) {
      return { sent: 0, skipped: true, reason: error?.message || 'no_orders' };
    }

    const results = [];
    for (const order of orders) {
      if (!order.tracking_token) {
        results.push({ sent: false, skipped: true, reason: 'missing_tracking_token', orderId: order.id });
        continue;
      }
      const trackingUrl = buildTrackingUrlFromBase(trackingBaseUrl, order.tracking_token);
      const body = `Hi ${order.customer_name || 'there'}, your NodeRoute delivery is on the way. Track your driver live: ${trackingUrl}`;
      const result = await safeSendSms(order.customer_phone, body, {
        event: 'route_dispatched',
        routeId,
        orderId: order.id,
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
    return safeSendSms(order?.customer_phone, body, {
      event: 'driver_arriving',
      stopId,
      routeId,
      orderId: order?.id || null,
    });
  } catch (error) {
    logger.warn({ stopId, routeId, error: error?.message || String(error) }, 'Delivery arrival SMS failed');
    return { sent: false, error: error?.message || String(error) };
  }
}

async function notifyDeliveryCompleted(client, stopId, orderId) {
  try {
    const stop = await loadStop(client, stopId);
    const order = (await loadOrderForStop(client, stop)) || (await loadOrder(client, orderId));
    return safeSendSms(order?.customer_phone, 'Your NodeRoute delivery has been completed. Thank you!', {
      event: 'delivery_completed',
      stopId,
      orderId: order?.id || orderId || null,
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

    const result = await safeSendSms(order.customer_phone, body, {
      event: 'upcoming_stop',
      routeId,
      completedStopId,
      stopId: targetStop.id,
      orderId: order.id,
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
