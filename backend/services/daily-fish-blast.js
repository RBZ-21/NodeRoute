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

function applyScope(query, scope = {}) {
  if (scope.companyId) query = query.eq('company_id', scope.companyId);
  if (scope.locationId) query = query.eq('location_id', scope.locationId);
  return query;
}

function rowKey(companyId, locationId = null) {
  return `${companyId || ''}:${locationId || ''}`;
}

async function listBlastScopes(companyName = '') {
  const { data, error } = await supabase
    .from('companies')
    .select('id,name,settings')
    .order('name', { ascending: true });

  if (error || !Array.isArray(data) || !data.length) {
    return [{ companyId: null, companyName, locationId: null }];
  }

  const seen = new Set();
  return data
    .filter((company) => company?.id)
    .map((company) => ({
      companyId: company.id,
      companyName: company.name || company.settings?.business_name || companyName,
      locationId: null,
    }))
    .filter((scope) => {
      const key = rowKey(scope.companyId, scope.locationId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

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
async function fetchReceivedSinceCutoff(cutoff, scope = {}) {
  const historyQuery = supabase
    .from('inventory_stock_history')
    .select('item_number, change_qty, created_at, company_id, location_id')
    .eq('change_type', 'restock')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  const { data, error } = await applyScope(historyQuery, scope);

  if (error || !data || !data.length) return [];

  const itemNumbers = [...new Set(data.map((r) => r.item_number))];
  const inventoryQuery = supabase
    .from('seafood_inventory')
    .select('item_number, description, unit, company_id, location_id')
    .in('item_number', itemNumbers);
  const { data: inventory } = await applyScope(inventoryQuery, scope);

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
async function fetchEligibleCustomers(scope = {}) {
  const customerQuery = supabase
    .from('Customers')
    .select('id, company_name, phone_number, phone, sms_opt_out, status, company_id, location_id')
    .eq('status', 'active');
  const { data, error } = await applyScope(customerQuery, scope);

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

async function runDailyFishBlast(companyName = '', companyId = null, locationId = null, dryRun = false) {
  if (typeof locationId === 'boolean') {
    dryRun = locationId;
    locationId = null;
  }

  logger.info({ companyId, locationId, dryRun }, 'Daily fish blast: starting');

  // Idempotency guard — one blast per calendar day per company.
  const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
  const { data: existing } = await supabase
    .from('sms_blast_log')
    .select('id')
    .eq('blast_type', 'daily_fish')
    .eq('blast_date', today)
    .eq('company_id', companyId || '')
    .limit(1);
  if (existing && existing.length > 0) {
    logger.warn({ today, companyId }, 'Daily fish blast: already sent today — skipping');
    return { sent: 0, skipped: 0, reason: 'already_sent_today' };
  }

  // Load cutoff settings from the database
  const settings = await loadCompanySettings(companyId, companyName);
  const cutoff   = computeCutoffTimestamp(settings);
  const scope = { companyId, locationId };

  logger.info({ cutoff, orderCutoffHour: settings.orderCutoffHour, orderCutoffDay: settings.orderCutoffDay }, 'Daily fish blast: cutoff');

  const items = await fetchReceivedSinceCutoff(cutoff, scope);
  if (!items.length) {
    logger.info('Daily fish blast: no new inventory received since cutoff — skipping');
    return { sent: 0, skipped: 0, reason: 'no_inventory' };
  }

  const message = buildBlastMessage(items, settings.businessName || companyName);
  if (!message) {
    logger.info('Daily fish blast: message was empty — skipping');
    return { sent: 0, skipped: 0, reason: 'empty_message' };
  }

  const customers = await fetchEligibleCustomers(scope);
  logger.info({ customerCount: customers.length, itemCount: items.length }, 'Daily fish blast: sending');

  let sent = 0;
  let failed = 0;

  for (const customer of customers) {
    if (dryRun) {
      logger.info({ phone: customer.phone, customerId: customer.id, dryRun: true }, 'Daily fish blast: DRY RUN — SMS not sent');
      sent++;
    } else {
      const result = await sendSms(customer.phone, message);
      if (result.success) {
        sent++;
      } else {
        failed++;
        logger.warn({ customerId: customer.id, phone: customer.phone, error: result.error }, 'Daily fish blast: SMS failed');
      }
    }
  }

  // Record successful blast so it cannot fire again today.
  if (!dryRun) {
    await supabase.from('sms_blast_log').insert([{
      blast_type: 'daily_fish',
      blast_date: today,
      company_id: companyId || '',
      sent_count:  sent,
      created_at:  new Date().toISOString(),
    }]);
  }

  logger.info({ sent, failed, items: items.length, dryRun }, 'Daily fish blast: complete');
  return { sent, failed, items: items.length };
}

async function runDailyFishBlastForAllCompanies(companyName = '') {
  const scopes = await listBlastScopes(companyName);
  const results = [];

  for (const scope of scopes) {
    const result = await runDailyFishBlast(scope.companyName || companyName, scope.companyId, scope.locationId);
    results.push({ ...scope, ...result });
  }

  return {
    companies: results.length,
    sent: results.reduce((sum, result) => sum + (result.sent || 0), 0),
    failed: results.reduce((sum, result) => sum + (result.failed || 0), 0),
    results,
  };
}

module.exports = {
  runDailyFishBlast,
  runDailyFishBlastForAllCompanies,
  fetchReceivedSinceCutoff,
  fetchEligibleCustomers,
};
