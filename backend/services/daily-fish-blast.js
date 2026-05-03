'use strict';

/**
 * Daily Fish Blast
 * ─────────────────
 * Runs at 6:30 AM Eastern every weekday morning.
 * Pulls inventory items received since the order cutoff (loaded from
 * company settings), builds a concise SMS, and texts every active
 * opted-in customer that has a phone number on file.
 *
 * Opt-out: customers with sms_opt_out = true are skipped.
 */

const { supabase } = require('./supabase');
const { sendSms }  = require('./sms');
const logger       = require('./logger');
const { loadCompanySettings, computeCutoffTimestamp } = require('./company-settings');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize a raw phone string to E.164 (US assumed if no country code). */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
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

  const itemNumbers = [...new Set(data.map((r) => r.item_number))];
  const { data: inventory } = await supabase
    .from('seafood_inventory')
    .select('item_number, description, unit')
    .in('item_number', itemNumbers);

  const descMap = {};
  (inventory || []).forEach((i) => { descMap[i.item_number] = i; });

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
  const header = `${companyName ? companyName + ' \u2014 ' : ''}Fresh Catch ${date}:`;
  if (!items.length) return null;
  const lines = items.map((i) => {
    const qty = i.qty % 1 === 0 ? i.qty.toString() : i.qty.toFixed(1);
    const unit = i.unit ? ` ${i.unit}` : '';
    return `\u2022 ${i.description} (${qty}${unit})`;
  });
  return [header, ...lines, '\nReply STOP to unsubscribe.'].join('\n');
}

/** Fetch all opted-in active customers with a usable phone number. */
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

async function runDailyFishBlast(companyName = '', companyId = null) {
  logger.info('Daily fish blast: starting');

  // Load cutoff settings from the database
  const settings = await loadCompanySettings(companyId, companyName);
  const cutoff   = computeCutoffTimestamp(settings);

  logger.info({ cutoff, orderCutoffHour: settings.orderCutoffHour, orderCutoffDay: settings.orderCutoffDay }, 'Daily fish blast: cutoff');

  const items = await fetchReceivedSinceCutoff(cutoff);
  if (!items.length) {
    logger.info('Daily fish blast: no new inventory received since cutoff — skipping');
    return { sent: 0, skipped: 0, reason: 'no_inventory' };
  }

  const message = buildBlastMessage(items, settings.businessName || companyName);
  if (!message) {
    logger.info('Daily fish blast: message was empty — skipping');
    return { sent: 0, skipped: 0, reason: 'empty_message' };
  }

  const customers = await fetchEligibleCustomers();
  logger.info({ customerCount: customers.length, itemCount: items.length }, 'Daily fish blast: sending');

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
