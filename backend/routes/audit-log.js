'use strict';

/**
 * audit-log.js — Customer Activity Audit Log
 *
 * Endpoints:
 *   GET /api/audit-log              — Full activity log (all action types, all customers)
 *   GET /api/audit-log/overrides    — Overrides-only report
 *   GET /api/audit-log/customer/:id — All activity for one customer
 *
 * All endpoints: admin + manager only.
 * Supports filters: start_date, end_date, user_id, action_type, customer_id, limit, offset
 */

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { filterRowsByContext, rowMatchesContext, scopeQueryByContext } = require('../services/operating-context');
const logger = require('../services/logger');

const router = express.Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ── Helpers ───────────────────────────────────────────────────────────────

function parsePaging(query) {
  const limit = Math.min(parseInt(query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

async function hydrateUsers(rows, idField = 'performed_by', context = null) {
  const ids = [...new Set(rows.map((r) => r[idField]).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await scopeQueryByContext(supabase.from('users').select('id,email,name,company_id,location_id'), context).in('id', ids);
  const map = {};
  (data || []).forEach((u) => { map[u.id] = u; });
  return map;
}

async function hydrateCustomers(rows, idField = 'customer_id', context = null) {
  const ids = [...new Set(rows.map((r) => r[idField]).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await scopeQueryByContext(supabase.from('Customers').select('id,company_name,company_id,location_id'), context).in('id', ids);
  const map = {};
  (data || []).forEach((c) => { map[c.id] = c; });
  return map;
}

function applyDateFilters(query, startDate, endDate) {
  if (startDate) query = query.gte('created_at', new Date(startDate).toISOString());
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    query = query.lte('created_at', end.toISOString());
  }
  return query;
}

// ── GET /api/audit-log ────────────────────────────────────────────────────
/**
 * Full customer activity log.
 * Sources:
 *   1. audit_log table (broad app-wide events)
 *   2. credit_hold_log table (credit-specific events)
 *   3. credit_hold_overrides (override grants)
 * Merged, sorted by created_at DESC.
 */
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { limit, offset } = parsePaging(req.query);
    const { start_date, end_date, user_id, action_type, customer_id } = req.query;

    // ── Source 1: audit_log ──
    let auditQ = scopeQueryByContext(supabase
      .from('audit_log')
      .select('*'), req.context)
      .order('created_at', { ascending: false })
      .limit(MAX_LIMIT);
    auditQ = applyDateFilters(auditQ, start_date, end_date);
    if (user_id) auditQ = auditQ.eq('performed_by', user_id);
    if (action_type) auditQ = auditQ.eq('action_type', action_type);
    if (customer_id) auditQ = auditQ.eq('customer_id', parseInt(customer_id, 10));

    // ── Source 2: credit_hold_log ──
    let creditQ = scopeQueryByContext(supabase
      .from('credit_hold_log')
      .select('*'), req.context)
      .order('created_at', { ascending: false })
      .limit(MAX_LIMIT);
    creditQ = applyDateFilters(creditQ, start_date, end_date);
    if (user_id) creditQ = creditQ.eq('performed_by', user_id);
    if (action_type) creditQ = creditQ.eq('event_type', action_type);
    if (customer_id) creditQ = creditQ.eq('customer_id', parseInt(customer_id, 10));

    // ── Source 3: credit_hold_overrides ──
    let overrideQ = scopeQueryByContext(supabase
      .from('credit_hold_overrides')
      .select('*'), req.context)
      .order('created_at', { ascending: false })
      .limit(MAX_LIMIT);
    overrideQ = applyDateFilters(overrideQ, start_date, end_date);
    if (user_id) overrideQ = overrideQ.eq('overridden_by', user_id);
    if (customer_id) overrideQ = overrideQ.eq('customer_id', parseInt(customer_id, 10));

    const [auditRes, creditRes, overrideRes] = await Promise.all([auditQ, creditQ, overrideQ]);

    // Normalise all sources into a single shape.
    const auditRows = (auditRes.data || []).map((r) => ({
      id: `al_${r.id}`,
      source: 'audit_log',
      action_type: r.action_type,
      customer_id: r.customer_id || null,
      order_id: r.order_id || null,
      performed_by: r.performed_by,
      notes: r.notes || null,
      metadata: r.metadata || null,
      created_at: r.created_at,
      company_id: r.company_id,
      location_id: r.location_id,
    }));

    const creditRows = (creditRes.data || []).map((r) => ({
      id: `ch_${r.id}`,
      source: 'credit_hold_log',
      action_type: r.event_type,
      customer_id: r.customer_id || null,
      order_id: r.order_id || null,
      performed_by: r.performed_by,
      notes: r.notes || null,
      metadata: {
        balance: r.balance,
        previous_credit_limit: r.previous_credit_limit,
        new_credit_limit: r.new_credit_limit,
        triggered_by: r.triggered_by,
        override_reason: r.override_reason,
      },
      created_at: r.created_at,
      company_id: r.company_id,
      location_id: r.location_id,
    }));

    const overrideRows = (overrideRes.data || []).map((r) => ({
      id: `ov_${r.id}`,
      source: 'credit_hold_overrides',
      action_type: 'order_allowed_override',
      customer_id: r.customer_id || null,
      order_id: r.order_id || null,
      performed_by: r.overridden_by,
      notes: r.override_reason || null,
      metadata: {
        expires_at: r.expires_at,
        consumed_at: r.consumed_at,
        customer_balance_at_override: r.customer_balance_at_override,
        credit_limit_at_override: r.credit_limit_at_override,
      },
      created_at: r.created_at,
      company_id: r.company_id,
      location_id: r.location_id,
    }));

    // Filter by action_type on override rows (they always have action_type = order_allowed_override)
    const allRows = [...auditRows, ...creditRows, ...overrideRows]
      .filter((r) => !action_type || r.action_type === action_type)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const scoped = filterRowsByContext(allRows, req.context);
    const page = scoped.slice(offset, offset + limit);

    // Hydrate users and customers in one pass.
    const [usersById, customersById] = await Promise.all([
      hydrateUsers(page, 'performed_by', req.context),
      hydrateCustomers(page, 'customer_id', req.context),
    ]);

    const enriched = page.map((r) => ({
      ...r,
      performed_by_email: usersById[r.performed_by]?.email || null,
      performed_by_name: usersById[r.performed_by]?.name || null,
      company_name: customersById[r.customer_id]?.company_name || null,
    }));

    res.json({
      events: enriched,
      paging: {
        limit,
        offset,
        total: scoped.length,
        next_offset: scoped.length > offset + limit ? offset + limit : null,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'audit-log fetch failed');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/audit-log/overrides ──────────────────────────────────────────
/**
 * Overrides-only report with full context.
 * Shows every credit override ever granted: who did it, for which customer,
 * on which order, the balance at the time, whether it was consumed or expired.
 */
router.get('/overrides', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { limit, offset } = parsePaging(req.query);
    const { start_date, end_date, user_id, customer_id } = req.query;

    let q = scopeQueryByContext(supabase
      .from('credit_hold_overrides')
      .select('*'), req.context)
      .order('created_at', { ascending: false })
      .limit(MAX_LIMIT);
    q = applyDateFilters(q, start_date, end_date);
    if (user_id) q = q.eq('overridden_by', user_id);
    if (customer_id) q = q.eq('customer_id', parseInt(customer_id, 10));

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const scoped = filterRowsByContext(data || [], req.context);
    const page = scoped.slice(offset, offset + limit);

    const [usersById, customersById] = await Promise.all([
      hydrateUsers(page, 'overridden_by', req.context),
      hydrateCustomers(page, 'customer_id', req.context),
    ]);

    const STALE_MS = 7 * 86_400_000;
    const enriched = page.map((o) => ({
      ...o,
      overridden_by_email: usersById[o.overridden_by]?.email || null,
      overridden_by_name: usersById[o.overridden_by]?.name || null,
      company_name: customersById[o.customer_id]?.company_name || null,
      is_stale: !o.consumed_at && (Date.now() - new Date(o.created_at).getTime() > STALE_MS),
      is_expired: !!o.expires_at && new Date(o.expires_at).getTime() < Date.now(),
    }));

    res.json({
      overrides: enriched,
      summary: {
        total: scoped.length,
        consumed: scoped.filter((o) => !!o.consumed_at).length,
        expired: scoped.filter((o) => o.expires_at && new Date(o.expires_at) < new Date()).length,
        active: scoped.filter((o) => !o.consumed_at && (!o.expires_at || new Date(o.expires_at) > new Date())).length,
        stale: scoped.filter((o) => !o.consumed_at && (Date.now() - new Date(o.created_at).getTime() > STALE_MS)).length,
      },
      paging: { limit, offset, total: scoped.length, next_offset: scoped.length > offset + limit ? offset + limit : null },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'audit overrides fetch failed');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/audit-log/customer/:id ───────────────────────────────────────
/**
 * Full activity trail for one customer — every credit event, override,
 * order change, and settings edit that touched this customer.
 */
router.get('/customer/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: 'Invalid customer id' });

  try {
    const { limit, offset } = parsePaging(req.query);
    const { start_date, end_date, action_type } = req.query;

    // Verify customer exists + context.
    const { data: customer, error: cErr } = await scopeQueryByContext(supabase
      .from('Customers').select('id,company_name,company_id,location_id'), req.context).eq('id', customerId).single();
    if (cErr || !customer) return res.status(404).json({ error: 'Customer not found' });
    if (!rowMatchesContext(customer, req.context)) return res.status(403).json({ error: 'Forbidden' });

    // Pull all three sources filtered to this customer.
    let [auditQ, creditQ, overrideQ] = [
      scopeQueryByContext(supabase.from('audit_log').select('*'), req.context).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(MAX_LIMIT),
      scopeQueryByContext(supabase.from('credit_hold_log').select('*'), req.context).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(MAX_LIMIT),
      scopeQueryByContext(supabase.from('credit_hold_overrides').select('*'), req.context).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(MAX_LIMIT),
    ];
    auditQ = applyDateFilters(auditQ, start_date, end_date);
    creditQ = applyDateFilters(creditQ, start_date, end_date);
    overrideQ = applyDateFilters(overrideQ, start_date, end_date);
    if (action_type) { auditQ = auditQ.eq('action_type', action_type); creditQ = creditQ.eq('event_type', action_type); }

    const [auditRes, creditRes, overrideRes] = await Promise.all([auditQ, creditQ, overrideQ]);

    const normalise = (rows, src, typeField, performedByField) => rows.map((r) => ({
      id: `${src}_${r.id}`,
      source: src,
      action_type: r[typeField],
      order_id: r.order_id || null,
      performed_by: r[performedByField],
      notes: r.notes || r.override_reason || null,
      metadata: src === 'credit_hold_overrides'
        ? { expires_at: r.expires_at, consumed_at: r.consumed_at, balance_at_time: r.customer_balance_at_override, limit_at_time: r.credit_limit_at_override }
        : src === 'credit_hold_log'
        ? { balance: r.balance, previous_credit_limit: r.previous_credit_limit, new_credit_limit: r.new_credit_limit, triggered_by: r.triggered_by }
        : r.metadata || null,
      created_at: r.created_at,
      company_id: r.company_id,
      location_id: r.location_id,
    }));

    const all = [
      ...normalise(auditRes.data || [], 'audit_log', 'action_type', 'performed_by'),
      ...normalise(creditRes.data || [], 'credit_hold_log', 'event_type', 'performed_by'),
      ...normalise(overrideRes.data || [], 'credit_hold_overrides', 'action_type', 'overridden_by').map((r) => ({ ...r, action_type: 'order_allowed_override' })),
    ].filter((r) => !action_type || r.action_type === action_type)
     .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const page = all.slice(offset, offset + limit);
    const usersById = await hydrateUsers(page, 'performed_by', req.context);

    res.json({
      customer_id: customerId,
      company_name: customer.company_name,
      events: page.map((r) => ({
        ...r,
        performed_by_email: usersById[r.performed_by]?.email || null,
        performed_by_name: usersById[r.performed_by]?.name || null,
      })),
      paging: { limit, offset, total: all.length, next_offset: all.length > offset + limit ? offset + limit : null },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'customer audit trail failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
