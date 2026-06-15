'use strict';

/**
 * AI Insights
 * ───────────
 * Runs the existing AI analyses (operational anomaly detection, smart reorder
 * alerts, AI collections risk) on a schedule, per company, and stores the
 * results in the ai_insights table so the dashboard can surface them
 * proactively. The manual "Run" buttons in the UI stay as a re-run option.
 *
 * Idempotency: each refresh replaces the company's unacknowledged rows of the
 * same type, so running the job twice produces the same end state and never
 * stacks duplicates. Acknowledged rows are left untouched as history.
 */

const logger = require('./logger');
const { supabase } = require('./supabase');
const {
  detectAnomalies,
  generateBulkReorderAlerts,
  scoreLatePaymentRisk,
} = require('./ai');

const DAY_MS = 86_400_000;

function aiNotConfigured(err) {
  return String(err?.message || '').includes('OPENAI_API_KEY');
}

// Normalize the various AI severity vocabularies (CRITICAL/WARNING/LOW,
// HIGH/MEDIUM/LOW, …) onto the ai_insights severity scale.
function normalizeSeverity(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high' || v === 'urgent') return 'high';
  if (v === 'medium' || v === 'warning' || v === 'moderate') return 'medium';
  if (v === 'low' || v === 'scheduled') return 'low';
  return 'info';
}

function maxSeverity(values, fallback = 'info') {
  const order = ['info', 'low', 'medium', 'high', 'critical'];
  let best = -1;
  for (const value of values) {
    const idx = order.indexOf(normalizeSeverity(value));
    if (idx > best) best = idx;
  }
  return best > 0 ? order[best] : fallback;
}

// ── Per-company analysis runners ─────────────────────────────────────────────
// These mirror the data gathering in routes/ai.js but scope by an explicit
// company_id instead of req.context (there is no request in a cron job).

async function runAnomalyInsight(companyId) {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const [{ data: deliveries }, { data: orders }] = await Promise.all([
    supabase.from('stops')
      .select('id,status,created_at,driver_id,company_id,location_id')
      .eq('company_id', companyId)
      .gte('created_at', since),
    supabase.from('orders')
      .select('id,status,customer_name,created_at,company_id,location_id')
      .eq('company_id', companyId)
      .gte('created_at', since),
  ]);
  const result = await detectAnomalies(deliveries || [], orders || []);
  const anomalies = Array.isArray(result?.anomalies) ? result.anomalies : [];
  if (!anomalies.length) return null;
  return {
    severity: maxSeverity(anomalies.map((a) => a.severity), 'medium'),
    payload: { count: anomalies.length, summary: result.summary || '', anomalies },
  };
}

async function runReorderInsight(companyId) {
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('item_number,description,on_hand_qty,unit,cost,company_id,location_id')
    .eq('company_id', companyId)
    .order('description');
  if (pErr) throw pErr;
  if (!products?.length) return null;

  const since = new Date(Date.now() - 28 * DAY_MS).toISOString();
  const { data: history } = await supabase
    .from('inventory_stock_history')
    .select('item_number,change_qty,change_type,created_at,company_id,location_id')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .in('change_type', ['pick', 'sale', 'depletion', 'adjustment']);

  const usageByItem = {};
  for (const row of (history || [])) {
    usageByItem[row.item_number] = (usageByItem[row.item_number] || 0) + Math.abs(Number(row.change_qty) || 0);
  }
  const enriched = products.map((p) => {
    const dailyUsage = (usageByItem[p.item_number] || 0) / 28;
    const onHand = Math.max(0, Number(p.on_hand_qty) || 0);
    return {
      ...p,
      daily_usage: dailyUsage,
      days_until_stockout: dailyUsage > 0 ? Math.round(onHand / dailyUsage) : null,
      reorder_qty: Math.max(1, Math.round(dailyUsage * 14)),
    };
  });

  const result = await generateBulkReorderAlerts(enriched);
  // alerts carry urgency: "CRITICAL" | "WARNING" | "LOW"
  const alerts = Array.isArray(result?.alerts) ? result.alerts : [];
  if (!alerts.length) return null;
  return {
    severity: maxSeverity(alerts.map((a) => a.urgency), 'medium'),
    payload: { count: alerts.length, summary: result.summary || '', alerts },
  };
}

async function runCollectionsInsight(companyId) {
  const { data: invoices, error: iErr } = await supabase
    .from('invoices')
    .select('id,customer_name,total,status,due_date,created_at,company_id,location_id')
    .eq('company_id', companyId)
    .in('status', ['sent', 'overdue', 'draft'])
    .order('due_date', { ascending: true });
  if (iErr) throw iErr;

  const today = Date.now();
  const byCustomer = {};
  for (const inv of (invoices || [])) {
    const name = inv.customer_name || 'Unknown';
    if (!byCustomer[name]) byCustomer[name] = { customer_name: name, total_open: 0, invoice_count: 0, oldest_invoice_days: 0, days_overdue_max: 0 };
    const dueMs = inv.due_date ? new Date(inv.due_date).getTime() : null;
    byCustomer[name].total_open += Number(inv.total) || 0;
    byCustomer[name].invoice_count += 1;
    byCustomer[name].oldest_invoice_days = Math.max(byCustomer[name].oldest_invoice_days, inv.created_at ? Math.round((today - new Date(inv.created_at).getTime()) / DAY_MS) : 0);
    byCustomer[name].days_overdue_max = Math.max(byCustomer[name].days_overdue_max, dueMs ? Math.max(0, Math.round((today - dueMs) / DAY_MS)) : 0);
  }
  const customerData = Object.values(byCustomer).filter((c) => c.total_open > 0);
  if (!customerData.length) return null;

  const result = await scoreLatePaymentRisk(customerData);
  // risks carry risk_level: "HIGH" | "MEDIUM" | "LOW"
  const risks = Array.isArray(result?.risks) ? result.risks : [];
  const flagged = risks.filter((r) => ['medium', 'high'].includes(normalizeSeverity(r.risk_level)));
  if (!flagged.length) return null;
  return {
    severity: maxSeverity(flagged.map((r) => r.risk_level), 'medium'),
    payload: { count: flagged.length, summary: result.summary || '', risks: flagged },
  };
}

const INSIGHT_RUNNERS = {
  anomaly: runAnomalyInsight,
  reorder: runReorderInsight,
  collections: runCollectionsInsight,
};

// ── Storage ──────────────────────────────────────────────────────────────────

async function replaceInsight(companyId, type, insight) {
  // Idempotent refresh: clear the previous unacknowledged row(s) for this
  // company+type, then insert the fresh result (if there is one).
  const { error: delErr } = await supabase
    .from('ai_insights')
    .delete()
    .eq('company_id', companyId)
    .eq('type', type)
    .is('acknowledged_at', null);
  if (delErr) throw delErr;

  if (!insight) return false;
  const { error: insErr } = await supabase
    .from('ai_insights')
    .insert([{ company_id: companyId, type, severity: insight.severity, payload: insight.payload }]);
  if (insErr) throw insErr;
  return true;
}

async function runAiInsightsForCompany(companyId) {
  const results = {};
  for (const [type, runner] of Object.entries(INSIGHT_RUNNERS)) {
    try {
      const insight = await runner(companyId);
      const stored = await replaceInsight(companyId, type, insight);
      results[type] = stored ? 'stored' : 'clear';
    } catch (err) {
      if (aiNotConfigured(err)) {
        results[type] = 'ai_not_configured';
        logger.warn({ companyId, type }, 'AI insights: skipped, AI service not configured');
      } else {
        results[type] = 'error';
        logger.error({ err, companyId, type }, 'AI insights: analysis failed');
      }
    }
  }
  return results;
}

async function runAiInsightsForAllCompanies() {
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id,name')
    .order('name', { ascending: true });
  if (error) throw error;

  const summary = [];
  for (const company of (companies || []).filter((c) => c?.id)) {
    const companyId = String(company.id);
    const results = await runAiInsightsForCompany(companyId);
    summary.push({ companyId, results });
  }
  logger.info({ companies: summary.length }, 'AI insights refresh completed');
  return { companies: summary.length, summary };
}

module.exports = {
  runAiInsightsForCompany,
  runAiInsightsForAllCompanies,
};
