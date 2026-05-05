"use strict";
// Printer integration: try external printer service; fallback to local queue.
// This module is intentionally lightweight to integrate quickly with existing code.

const fetch = global.fetch; // Node 18+ has global fetch; otherwise, this will be undefined
const { renderOrderSlip } = require('./print-template');

async function triggerExternalPrint(order, items, context = {}) {
  const url = process.env.PRINTER_SERVICE_URL;
  if (!url) return { ok: false, reason: 'Printer service URL not configured' };
  const payload = {
    order_id: order.id,
    order_number: order.order_number,
    customer_name: order.customer_name,
    timestamp: new Date().toISOString(),
    template: 'order-slip',
    // A lightweight representation of the printable content
    slip: renderOrderSlip({ ...order, items }),
  };
  try {
    if (typeof fetch === 'function') {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, status: res.status, text };
      }
      return { ok: true };
    }
    // If fetch is not available, fall back to queue path below (queue path exists regardless of fetch)
    return { ok: false, reason: 'Fetch API not available' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function enqueuePrintJob(order, items, context = {}) {
  // Minimal queue: store to a hypothetical printer_queue table if available.
  // We avoid failing order creation if queueing is not possible.
  try {
    const { supabase } = require('../services/supabase');
    if (!supabase) return { ok: false, reason: 'Supabase client unavailable' };
    const payload = {
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      items: items,
      created_at: new Date().toISOString(),
      template: 'order-slip',
      status: 'pending',
    };
    const { data, error } = await supabase.from('printer_queue').insert([payload]).single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  } catch (err) {
    // Do not fail the upstream flow
    return { ok: false, error: err?.message || String(err) };
  }
}

async function triggerPrintJob(order, items, context = {}) {
  // Try external printer first; if not configured or failed, enqueue for fallback
  const external = await triggerExternalPrint(order, items, context);
  if (external?.ok) {
    return external;
  }
  // Log/trace and attempt enqueue as fallback
  const queue = await enqueuePrintJob(order, items, context);
  return queue.ok ? { ok: true, queued: true } : { ok: false, reason: 'Printer not available and queueing failed', queueError: queue.error };
}

module.exports = {
  triggerPrintJob,
  enqueuePrintJob,
};
