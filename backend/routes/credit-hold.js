'use strict';

const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  filterRowsByContext,
  rowMatchesContext,
} = require('../services/operating-context');
const creditEngine = require('../services/creditEngine');
const logger = require('../services/logger');

const router = express.Router();

const VALID_TERMS = ['COD', 'NET7', 'NET14', 'NET21', 'NET30', 'NET45', 'NET60', 'NET90', 'PREPAY'];
const VALID_HOLD_REASONS = ['over_limit', 'past_due', 'manual', 'new_account', 'bounced_check', 'disputed_invoice'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseDecimal(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : NaN;
}

async function loadCustomerOr403(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid customer id' });
    return null;
  }
  const { data, error } = await supabase.from('Customers').select('*').eq('id', id).single();
  if (error || !data) {
    res.status(404).json({ error: 'Customer not found' });
    return null;
  }
  if (!rowMatchesContext(data, req.context)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return data;
}

// ── 3A. GET /api/credit/customer/:id/status ────────────────────────────────
router.get('/customer/:id/status', authenticateToken, async (req, res) => {
  const customer = await loadCustomerOr403(req, res);
  if (!customer) return;

  try {
    await creditEngine.calculateCustomerBalance(customer.id);
    const status = await creditEngine.checkCreditStatus(customer.id);
    const refreshed = (await supabase.from('Customers').select('*').eq('id', customer.id).single()).data || customer;

    const limit = refreshed.credit_limit == null ? null : creditEngine.toMoney(refreshed.credit_limit);
    const balance = creditEngine.toMoney(refreshed.current_balance || 0);
    const available = limit == null ? null : creditEngine.toMoney(limit - balance);

    res.json({
      customer_id: refreshed.id,
      company_name: refreshed.company_name,
      credit_limit: limit,
      current_balance: balance,
      available_credit: available,
      credit_status: refreshed.credit_status || status.current_status,
      on_hold: !!refreshed.credit_hold,
      hold_reason: refreshed.credit_hold_reason || null,
      hold_placed_at: refreshed.credit_hold_placed_at || null,
      hold_notes: refreshed.hold_notes || null,
      auto_hold_enabled: refreshed.auto_hold_enabled !== false,
      warning_threshold_pct: refreshed.warning_threshold_pct == null ? 80 : Number(refreshed.warning_threshold_pct),
      credit_terms: refreshed.credit_terms || refreshed.payment_terms || 'NET30',
      avg_days_to_pay: refreshed.avg_days_to_pay || 0,
      last_payment_date: refreshed.last_payment_date || null,
      last_payment_amount: refreshed.last_payment_amount == null ? null : creditEngine.toMoney(refreshed.last_payment_amount),
      oldest_unpaid_invoice_date: refreshed.oldest_unpaid_invoice_date || null,
      days_past_due: status.oldest_past_due_days,
      days_until_next_invoice_due: status.days_until_next_invoice_due,
      should_be_on_hold: status.should_hold,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'credit status fetch failed');
    res.status(500).json({ error: err.message });
  }
});

// ── 3B. POST /api/credit/customer/:id/hold ─────────────────────────────────
router.post('/customer/:id/hold', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const customer = await loadCustomerOr403(req, res);
  if (!customer) return;

  const reason = req.body?.reason ? String(req.body.reason).trim().toLowerCase() : 'manual';
  if (!VALID_HOLD_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${VALID_HOLD_REASONS.join(', ')}` });
  }
  const notes = nonEmptyString(req.body?.notes) ? req.body.notes.trim() : null;

  try {
    const updated = await creditEngine.applyHold(customer.id, reason, req.user.id, notes, 'manager_manual', req.context);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3C. POST /api/credit/customer/:id/release ──────────────────────────────
router.post('/customer/:id/release', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const customer = await loadCustomerOr403(req, res);
  if (!customer) return;

  const notes = nonEmptyString(req.body?.notes) ? req.body.notes.trim() : null;
  if (!notes) {
    return res.status(400).json({ error: 'notes is required when releasing a hold' });
  }

  try {
    const updated = await creditEngine.releaseHold(customer.id, req.user.id, notes, 'manager_manual', req.context);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3D. POST /api/credit/customer/:id/override ─────────────────────────────
router.post('/customer/:id/override', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const customer = await loadCustomerOr403(req, res);
  if (!customer) return;

  const order_id = req.body?.order_id ? String(req.body.order_id).trim() : '';
  const reason = req.body?.reason ? String(req.body.reason).trim() : '';
  const expires_at = req.body?.expires_at ? new Date(req.body.expires_at) : null;

  if (!order_id) return res.status(400).json({ error: 'order_id is required' });
  if (!reason) return res.status(400).json({ error: 'override reason is required and cannot be empty' });
  if (expires_at && Number.isNaN(expires_at.getTime())) {
    return res.status(400).json({ error: 'expires_at must be a valid ISO date' });
  }

  try {
    const overridePayload = {
      customer_id: customer.id,
      order_id,
      overridden_by: req.user.id,
      override_reason: reason,
      customer_balance_at_override: creditEngine.toMoney(customer.current_balance || 0),
      credit_limit_at_override: customer.credit_limit == null ? null : creditEngine.toMoney(customer.credit_limit),
      expires_at: expires_at ? expires_at.toISOString() : null,
      is_one_time: req.body?.is_one_time !== false,
      company_id: req.context?.activeCompanyId || req.context?.companyId || null,
      location_id: req.context?.activeLocationId || req.context?.locationId || null,
    };

    const { data, error } = await supabase
      .from('credit_hold_overrides')
      .insert([overridePayload])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await creditEngine.logEvent({
      customer_id: customer.id,
      event_type: 'order_allowed_override',
      balance: customer.current_balance,
      triggered_by: 'manager_manual',
      performed_by: req.user.id,
      order_id,
      override_reason: reason,
      notes: `Override granted by ${req.user.email || req.user.id}`,
      company_id: overridePayload.company_id,
      location_id: overridePayload.location_id,
    });

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3E. PATCH /api/credit/customer/:id/settings ────────────────────────────
router.patch('/customer/:id/settings', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const customer = await loadCustomerOr403(req, res);
  if (!customer) return;

  const updates = {};
  const events = [];

  if (req.body?.credit_limit !== undefined) {
    const limit = parseDecimal(req.body.credit_limit);
    if (limit !== null && (Number.isNaN(limit) || limit < 0)) {
      return res.status(400).json({ error: 'credit_limit must be null or a non-negative number' });
    }
    if (creditEngine.toCents(limit || 0) !== creditEngine.toCents(customer.credit_limit || 0)) {
      updates.credit_limit = limit;
      events.push({
        event_type: 'limit_changed',
        previous_credit_limit: customer.credit_limit == null ? null : creditEngine.toMoney(customer.credit_limit),
        new_credit_limit: limit == null ? null : creditEngine.toMoney(limit),
      });
    }
  }

  if (req.body?.credit_terms !== undefined) {
    const terms = String(req.body.credit_terms || '').toUpperCase().trim();
    if (!VALID_TERMS.includes(terms)) {
      return res.status(400).json({ error: `credit_terms must be one of: ${VALID_TERMS.join(', ')}` });
    }
    if ((customer.credit_terms || customer.payment_terms || '').toUpperCase() !== terms) {
      updates.credit_terms = terms;
      events.push({
        event_type: 'terms_changed',
        previous_credit_terms: customer.credit_terms || customer.payment_terms || null,
        new_credit_terms: terms,
      });
    }
  }

  if (req.body?.warning_threshold_pct !== undefined) {
    const pct = parseDecimal(req.body.warning_threshold_pct);
    if (Number.isNaN(pct) || pct == null || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'warning_threshold_pct must be between 0 and 100' });
    }
    updates.warning_threshold_pct = pct;
  }

  if (req.body?.auto_hold_enabled !== undefined) {
    updates.auto_hold_enabled = !!req.body.auto_hold_enabled;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  updates.credit_reviewed_at = new Date().toISOString();
  updates.credit_reviewed_by = req.user.id;

  try {
    const { data, error } = await supabase
      .from('Customers')
      .update(updates)
      .eq('id', customer.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    for (const ev of events) {
      await creditEngine.logEvent({
        customer_id: customer.id,
        balance: customer.current_balance,
        triggered_by: 'manager_manual',
        performed_by: req.user.id,
        notes: `Changed by ${req.user.email || req.user.id}`,
        company_id: req.context?.activeCompanyId || req.context?.companyId,
        location_id: req.context?.activeLocationId || req.context?.locationId,
        ...ev,
      });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3F. GET /api/credit/customer/:id/history ───────────────────────────────
router.get('/customer/:id/history', authenticateToken, async (req, res) => {
  const customer = await loadCustomerOr403(req, res);
  if (!customer) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const { data, error } = await supabase
    .from('credit_hold_log')
    .select('*')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(limit + offset);
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).slice(offset, offset + limit);

  // Hydrate performed_by → user email/name.
  const userIds = [...new Set(rows.map((r) => r.performed_by).filter(Boolean))];
  let usersById = {};
  if (userIds.length) {
    const { data: users } = await supabase.from('users').select('id,email,name').in('id', userIds);
    (users || []).forEach((u) => { usersById[u.id] = u; });
  }

  res.json({
    customer_id: customer.id,
    company_name: customer.company_name,
    events: rows.map((r) => ({
      ...r,
      performed_by_email: usersById[r.performed_by]?.email || null,
      performed_by_name: usersById[r.performed_by]?.name || null,
    })),
    paging: { limit, offset, next_offset: rows.length === limit ? offset + limit : null },
  });
});

// ── 3G. GET /api/credit/holds/active ───────────────────────────────────────
router.get('/holds/active', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data, error } = await supabase
    .from('Customers')
    .select('*')
    .eq('credit_hold', true);
  if (error) return res.status(500).json({ error: error.message });

  const scoped = filterRowsByContext(data || [], req.context);

  const rows = scoped.map((c) => {
    const limit = c.credit_limit == null ? null : creditEngine.toMoney(c.credit_limit);
    const balance = creditEngine.toMoney(c.current_balance || 0);
    const overBy = limit != null && limit > 0 ? creditEngine.toMoney(Math.max(0, balance - limit)) : 0;
    const placedAt = c.credit_hold_placed_at ? new Date(c.credit_hold_placed_at) : null;
    const daysOnHold = placedAt ? Math.max(0, Math.floor((Date.now() - placedAt.getTime()) / 86_400_000)) : 0;
    return {
      customer_id: c.id,
      company_name: c.company_name,
      credit_limit: limit,
      current_balance: balance,
      over_by: overBy,
      hold_reason: c.credit_hold_reason,
      hold_placed_at: c.credit_hold_placed_at,
      hold_placed_by: c.hold_placed_by,
      hold_notes: c.hold_notes,
      days_on_hold: daysOnHold,
      oldest_unpaid_invoice_date: c.oldest_unpaid_invoice_date,
      sales_rep: c.sales_rep_email || c.assigned_rep_email || null,
    };
  }).sort((a, b) => b.over_by - a.over_by || b.days_on_hold - a.days_on_hold);

  res.json({ holds: rows, count: rows.length });
});

// ── 3H. GET /api/credit/dashboard ──────────────────────────────────────────
router.get('/dashboard', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data: customers, error } = await supabase
      .from('Customers')
      .select('id, credit_status, credit_hold, current_balance, credit_limit, oldest_unpaid_invoice_date, company_id, location_id');
    if (error) return res.status(500).json({ error: error.message });
    const scoped = filterRowsByContext(customers || [], req.context);

    const onHold = scoped.filter((c) => c.credit_hold === true);
    const inWarning = scoped.filter((c) => c.credit_status === 'warning' && !c.credit_hold);
    const totalPastDue = onHold
      .filter((c) => c.oldest_unpaid_invoice_date)
      .reduce((s, c) => s + creditEngine.toCents(c.current_balance || 0), 0);
    const totalAtRisk = scoped.reduce((s, c) => s + creditEngine.toCents(c.current_balance || 0), 0);

    // Orders blocked today.
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data: blocks } = await supabase
      .from('credit_hold_log')
      .select('id')
      .eq('event_type', 'order_blocked')
      .gte('created_at', startOfDay.toISOString());

    // Active overrides + stale flags.
    const { data: overrides } = await supabase
      .from('credit_hold_overrides')
      .select('id, created_at, consumed_at, expires_at')
      .is('consumed_at', null);
    const activeOverrides = (overrides || []).filter((o) => !o.expires_at || new Date(o.expires_at) > new Date());
    const staleCutoff = Date.now() - 7 * 86_400_000;
    const overridesPendingReview = activeOverrides.filter((o) => new Date(o.created_at).getTime() < staleCutoff).length;

    // Auto-releases in last 7 days.
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: autoReleases } = await supabase
      .from('credit_hold_log')
      .select('id')
      .eq('event_type', 'auto_released')
      .gte('created_at', weekAgo);

    res.json({
      customers_on_hold: onHold.length,
      customers_in_warning: inWarning.length,
      total_past_due_balance: creditEngine.toMoney(totalPastDue / 100),
      total_balance_at_risk: creditEngine.toMoney(totalAtRisk / 100),
      orders_blocked_today: (blocks || []).length,
      active_overrides: activeOverrides.length,
      overrides_pending_review: overridesPendingReview,
      holds_auto_released_this_week: (autoReleases || []).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3I. GET /api/credit/overrides ──────────────────────────────────────────
router.get('/overrides', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data, error } = await supabase
    .from('credit_hold_overrides')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });

  const scoped = filterRowsByContext(data || [], req.context);
  const customerIds = [...new Set(scoped.map((o) => o.customer_id))];
  const userIds = [...new Set(scoped.map((o) => o.overridden_by))];

  const [customersRes, usersRes] = await Promise.all([
    customerIds.length ? supabase.from('Customers').select('id,company_name').in('id', customerIds) : { data: [] },
    userIds.length ? supabase.from('users').select('id,email,name').in('id', userIds) : { data: [] },
  ]);
  const customersById = {};
  (customersRes.data || []).forEach((c) => { customersById[c.id] = c; });
  const usersById = {};
  (usersRes.data || []).forEach((u) => { usersById[u.id] = u; });

  const STALE_AGE_MS = 7 * 86_400_000;

  res.json(scoped.map((o) => ({
    ...o,
    company_name: customersById[o.customer_id]?.company_name || null,
    overridden_by_email: usersById[o.overridden_by]?.email || null,
    overridden_by_name: usersById[o.overridden_by]?.name || null,
    is_stale: !o.consumed_at && (Date.now() - new Date(o.created_at).getTime() > STALE_AGE_MS),
    is_expired: !!o.expires_at && new Date(o.expires_at).getTime() < Date.now(),
  })));
});

// ── 3J. POST /api/credit/run-check ─────────────────────────────────────────
router.post('/run-check', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const summary = await creditEngine.runScheduledCreditCheck();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
