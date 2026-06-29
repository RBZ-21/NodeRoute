'use strict';

const { supabase: defaultDb } = require('./supabase');
const { createMailer } = require('./email');

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeId(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nowDate(options = {}) {
  return options.now instanceof Date ? options.now : new Date(options.now || Date.now());
}

function locationFor(row, context = {}) {
  return row?.location_id || context.activeLocationId || context.locationId || null;
}

function recipientsFromOptions(options = {}) {
  if (Array.isArray(options.recipients) && options.recipients.length) return options.recipients;
  const configured = String(process.env.REPORT_ALERT_EMAILS || process.env.ALERT_EMAILS || '').trim();
  if (configured) return configured.split(',').map((value) => value.trim()).filter(Boolean);
  return [];
}

async function loadActiveRules(db, table, companyId, context = {}) {
  let query = db.from(table).select('*').eq('is_active', true);
  if (companyId) query = query.eq('company_id', companyId);
  if (context.activeLocationId || context.locationId) {
    query = query.or(`location_id.is.null,location_id.eq.${context.activeLocationId || context.locationId}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadScopedRows(db, table, companyId, context = {}) {
  let query = db.from(table).select('*');
  if (companyId) query = query.eq('company_id', companyId);
  if (context.activeLocationId || context.locationId) {
    query = query.or(`location_id.is.null,location_id.eq.${context.activeLocationId || context.locationId}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function hasCooldown(db, ruleId, entityId, alertType, companyId, at) {
  const since = new Date(at.getTime() - COOLDOWN_MS).toISOString();
  let query = db
    .from('alert_sends')
    .select('id,sent_at')
    .eq('rule_id', ruleId)
    .eq('entity_id', normalizeId(entityId))
    .eq('alert_type', alertType)
    .gte('sent_at', since)
    .limit(1);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function insertAlertSend(db, rule, entityId, alertType, context, at) {
  const record = {
    company_id: rule.company_id || context.activeCompanyId || context.companyId,
    location_id: locationFor(rule, context),
    rule_id: rule.id,
    entity_id: normalizeId(entityId),
    alert_type: alertType,
    sent_at: at.toISOString(),
  };
  const { data, error } = await db.from('alert_sends').insert(record).select().single();
  if (error) throw error;
  return data || record;
}

async function sendAlertEmail({ mailer, recipients, subject, text, html, idempotencyKey }) {
  if (!recipients.length) {
    return { skipped: true, reason: 'no_recipients' };
  }
  const activeMailer = mailer || createMailer();
  if (!activeMailer) {
    return { skipped: true, reason: 'mailer_not_configured' };
  }
  await activeMailer.sendMail({
    to: recipients,
    subject,
    text,
    html,
    idempotencyKey,
  });
  return { skipped: false };
}

function inventoryRuleMatches(rule, product) {
  if (rule.product_id && normalizeId(rule.product_id) !== normalizeId(product.id)) return false;
  if (rule.category_id) {
    const productCategory = normalizeId(product.category_id || product.category);
    if (normalizeId(rule.category_id) !== productCategory) return false;
  }
  return true;
}

function inventoryViolation(rule, product) {
  const onHand = toNumber(product.on_hand_qty ?? product.quantity ?? product.stock_qty, 0);
  if (rule.rule_type === 'out_of_stock') return onHand <= 0;
  return onHand <= toNumber(rule.threshold, 0);
}

function productLabel(product) {
  return product.description || product.name || product.item_number || product.id;
}

async function checkInventoryAlerts(companyId, options = {}) {
  const db = options.db || defaultDb;
  const context = options.context || { companyId, activeCompanyId: companyId };
  const at = nowDate(options);
  const recipients = recipientsFromOptions(options);
  const rules = await loadActiveRules(db, 'inventory_alert_rules', companyId, context);
  const products = await loadScopedRows(db, 'products', companyId, context);
  let sent = 0;
  let skippedCooldown = 0;
  let skippedNoMailer = 0;

  for (const rule of rules) {
    for (const product of products) {
      if (!inventoryRuleMatches(rule, product)) continue;
      if (!inventoryViolation(rule, product)) continue;
      const alertType = rule.rule_type;
      if (await hasCooldown(db, rule.id, product.id, alertType, companyId, at)) {
        skippedCooldown += 1;
        continue;
      }

      const onHand = toNumber(product.on_hand_qty ?? product.quantity ?? product.stock_qty, 0);
      const subject = `NodeRoute ${alertType.replace(/_/g, ' ')} alert: ${productLabel(product)}`;
      const text = `${productLabel(product)} is at ${onHand} on hand. Threshold: ${toNumber(rule.threshold, 0)}.`;
      const emailResult = await sendAlertEmail({
        mailer: options.mailer,
        recipients,
        subject,
        text,
        idempotencyKey: `inventory-alert:${rule.id}:${product.id}:${at.toISOString().slice(0, 10)}`,
      });
      if (emailResult.skipped) {
        skippedNoMailer += 1;
        continue;
      }
      await insertAlertSend(db, rule, product.id, alertType, context, at);
      sent += 1;
    }
  }

  return { sent, skipped_cooldown: skippedCooldown, skipped_no_mailer: skippedNoMailer };
}

function creditRuleMatches(rule, customer) {
  if (rule.customer_id && normalizeId(rule.customer_id) !== normalizeId(customer.id)) return false;
  return true;
}

function customerBalance(customer) {
  return toNumber(customer.current_balance ?? customer.open_balance ?? customer.balance, 0);
}

function creditViolation(rule, customer) {
  const limit = toNumber(customer.credit_limit ?? customer.credit_hold_threshold, 0);
  if (limit <= 0) return false;
  const balance = customerBalance(customer);
  if (rule.rule_type === 'over_limit') return balance > limit;
  const thresholdPct = toNumber(rule.threshold_pct, 90);
  return balance >= limit * (thresholdPct / 100);
}

async function checkCreditAlerts(companyId, options = {}) {
  const db = options.db || defaultDb;
  const context = options.context || { companyId, activeCompanyId: companyId };
  const at = nowDate(options);
  const recipients = recipientsFromOptions(options);
  const rules = await loadActiveRules(db, 'credit_alert_rules', companyId, context);
  const customers = await loadScopedRows(db, 'Customers', companyId, context);
  let sent = 0;
  let skippedCooldown = 0;
  let skippedNoMailer = 0;

  for (const rule of rules) {
    for (const customer of customers) {
      if (!creditRuleMatches(rule, customer)) continue;
      if (!creditViolation(rule, customer)) continue;
      const alertType = rule.rule_type;
      if (await hasCooldown(db, rule.id, customer.id, alertType, companyId, at)) {
        skippedCooldown += 1;
        continue;
      }

      const balance = customerBalance(customer);
      const limit = toNumber(customer.credit_limit ?? customer.credit_hold_threshold, 0);
      const name = customer.company_name || customer.name || customer.id;
      const subject = `NodeRoute credit alert: ${name}`;
      const text = `${name} balance is ${balance.toFixed(2)} against a ${limit.toFixed(2)} credit limit.`;
      const emailResult = await sendAlertEmail({
        mailer: options.mailer,
        recipients,
        subject,
        text,
        idempotencyKey: `credit-alert:${rule.id}:${customer.id}:${at.toISOString().slice(0, 10)}`,
      });
      if (emailResult.skipped) {
        skippedNoMailer += 1;
        continue;
      }
      await insertAlertSend(db, rule, customer.id, alertType, context, at);
      sent += 1;
    }
  }

  return { sent, skipped_cooldown: skippedCooldown, skipped_no_mailer: skippedNoMailer };
}

async function listActiveCompanies(db = defaultDb) {
  const { data, error } = await db.from('companies').select('id,name,status').limit(1000);
  if (error || !Array.isArray(data) || !data.length) return [];
  return data.filter((company) => company.id && (!company.status || company.status === 'active'));
}

async function runAlertChecksForAllCompanies(options = {}) {
  const db = options.db || defaultDb;
  const companies = await listActiveCompanies(db);
  const results = [];
  for (const company of companies) {
    const context = { companyId: company.id, activeCompanyId: company.id };
    const inventory = await checkInventoryAlerts(company.id, { ...options, db, context });
    const credit = await checkCreditAlerts(company.id, { ...options, db, context });
    results.push({ company_id: company.id, inventory, credit });
  }
  return results;
}

module.exports = {
  checkCreditAlerts,
  checkInventoryAlerts,
  runAlertChecksForAllCompanies,
};
