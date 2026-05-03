'use strict';

/**
 * Daily Fish Blast
 * ─────────────────
 * Runs at 6:30 AM Eastern every weekday morning.
 * Pulls inventory items received since the previous order cutoff,
 * builds a concise SMS, and texts every active opted-in customer
 * that has a phone number on file.
 *
 * Order cutoff is defined as the last time `inventory_stock_history`
 * had a 'received' entry before today — or midnight yesterday as a
 * fallback.
 *
 * Opt-out: customers with sms_opt_out = true are skipped.
 */

const { supabase } = require('./supabase');
const { sendSms }  = require('./sms');
const logger       = require('./logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize a raw phone string to E.164 (US assumed if no country code). */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`; // international — pass through
  return null; // unparseable
}

/**
 * Returns the ISO timestamp of the last order cutoff.
 * Defined as: the created_at of the most recent 'received' entry in
 * inventory_stock_history before today's blast window.
 * Falls back to midnight UTC yesterday if no history found.
 */
async function getLastCutoffTimestamp() {
  const todayNoon = new Date();
  todayNoon.setHours(12, 0, 0, 0); // use noon to avoid catching today's entries

  const { data, error } = await supabase
    .from('inventory_stock_history')
    .select('created_at')
    .eq('change_type', 'received')
    .lt('created_at', todayNoon.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || !data.length) {
    // Fallback: midnight yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday.toISOString();
  }

  return data[0].created_at;
}

/** Fetch items received since the cutoff timestamp. */
async function fetchReceivedSinceCutoff(cutoff) {
  const { data, error } = await supabase
    .from('inventory_stock_history')
    .select('item_number, change_qty, created_at')
    .eq('change_type', 'received')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });

  if (error || !data || !data.length) return [];

  // Join to seafood_inventory to get the human-readable description
  const itemNumbers = [...new Set(data.map((r) => r.item_number))];
  const { data: inventory } = await supabase
    .from('seafood_inventory')
    .select('item_number, description, unit')
    .in('item_number', itemNumbers);

  const descMap = {};
  (inventory || []).forEach((i) => { descMap[i.item_number] = i; });

  // Aggregate total qty received per item
  const totals = {};
  data.forEach(({ item_number, change_qty }) => {
    totals[item_number] = (totals[item_number] || 0) + parseFloat(change_qty || 0);
  });

  return Object.entries(totals)
    .map(([item_number, qty]) => ({
      item_number,
      description: descMap[item_number]?.description || item_number,
      unit: descMap[item_number]?.unit || '',
      qty: parseFloat(qty.toFixed(2)),
    }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => a.description.localeCompare(b.description));
}

/** Build the SMS body from the received items list. */
function buildBlastMessage(items, companyName) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const header = `${companyName ? companyName + ' — ' : ''}Fresh Catch ${date}:`;

  if (!items.length) return null; // nothing to send

  // SMS has a 160-char soft limit per segment; keep it tight
  const lines = items.map((i) => {
    const qty = i.qty % 1 === 0 ? i.qty.toString() : i.qty.toFixed(1);
    const unit = i.unit ? ` ${i.unit}` : '';
    return `• ${i.description} (${qty}${unit})`;
  });

  const body = [header, ...lines, '\nReply STOP to unsubscribe.'].join('\n');
  return body;
}

/** Fetch all opted-in customers with a usable phone number. */
async function fetchEligibleCustomers() {
  const { data, error } = await supabase
    .from('Customers')
    .select('id, company_name, phone_number, phone, sms_opt_out, status')
    .eq('status', 'active');

  if (error || !data) return [];

  return data
    .filter((c) => !c.sms_opt_out)
    .map((c) => ({
      id: c.id,
      name: c.company_name,
      phone: normalizePhone(c.phone_number || c.phone),
    }))
    .filter((c) => c.phone !== null);
}

// ── Main export ───────────────────────────────────────────────────────────────

async function runDailyFishBlast(companyName = '') {
  logger.info('Daily fish blast: starting');

  const cutoff = await getLastCutoffTimestamp();
  logger.info({ cutoff }, 'Daily fish blast: cutoff timestamp');

  const items = await fetchReceivedSinceCutoff(cutoff);
  if (!items.length) {
    logger.info('Daily fish blast: no new inventory received since cutoff — skipping');
    return { sent: 0, skipped: 0, reason: 'no_inventory' };
  }

  const message = buildBlastMessage(items, companyName);
  if (!message) {
    logger.info('Daily fish blast: message was empty — skipping');
    return { sent: 0, skipped: 0, reason: 'empty_message' };
  }

  const customers = await fetchEligibleCustomers();
  logger.info({ count: customers.length, items: items.length }, 'Daily fish blast: sending');

  let sent = 0;
  let failed = 0;

  for (const customer of customers) {
    const result = await sendSms(customer.phone, message);
    if (result.success) {
      sent++;
    } else {
      failed++;
      logger.warn({ customerId: customer.id, phone: customer.phone, error: result.error }, 'Daily fish blast: SMS failed');
    }
  }

  logger.info({ sent, failed, items: items.length }, 'Daily fish blast: complete');
  return { sent, failed, items: items.length };
}

module.exports = { runDailyFishBlast };
