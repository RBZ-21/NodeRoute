'use strict';

/**
 * Credit Engine
 * ─────────────
 * Authoritative service for customer credit decisions. Every credit hold
 * placed, released, or overridden flows through here so the audit trail in
 * credit_hold_log stays the single source of truth.
 *
 * The engine writes to the existing Customers columns (credit_hold,
 * credit_hold_reason, credit_hold_placed_at) so the legacy order-block check
 * in routes/orders.js keeps working alongside the new flow.
 *
 * Money is handled as Decimal-rounded JS numbers (always passed through
 * toMoney) so a single rounding step happens at the boundary. Comparisons
 * use cents-integer math to avoid float drift.
 */

const { supabase } = require('./supabase');
const { createMailer } = require('./email');
const logger = require('./logger');
const { scopeQueryByContext } = require('./operating-context');
const { escapeLike } = require('../lib/escape-like');

// Invoice statuses that still represent money owed to us.
const OPEN_INVOICE_STATUSES = ['pending', 'sent', 'overdue', 'signed', 'delivered'];
const PAID_INVOICE_STATUSES = ['paid'];

const HOLD_REASON_LABELS = {
  over_limit: 'Account balance exceeds credit limit',
  past_due: 'Invoice(s) past due',
  manual: 'Manually placed by manager',
  new_account: 'New account — credit not yet established',
  bounced_check: 'Payment returned',
  disputed_invoice: 'Disputed invoice on file',
};

const TERMS_DAYS = {
  COD: 0,
  PREPAY: 0,
  NET7: 7,
  NET14: 14,
  NET21: 21,
  NET30: 30,
  NET45: 45,
  NET60: 60,
  NET90: 90,
};

// ── Money helpers ──────────────────────────────────────────────────────────
function toMoney(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function toCents(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ── Term parsing ───────────────────────────────────────────────────────────
function termDays(termsString) {
  if (!termsString) return null;
  const key = String(termsString).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key in TERMS_DAYS) return TERMS_DAYS[key];
  // Fallback: parse "Net 30", "30", "n30"
  const match = String(termsString).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function effectiveTerms(customer) {
  return customer?.credit_terms || customer?.payment_terms || 'NET30';
}

function daysBetween(later, earlier) {
  if (!later || !earlier) return 0;
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.floor(ms / 86_400_000);
}

// ── Notifications (fire-and-forget, fail-safe) ─────────────────────────────
let _mailer = null;
function getMailer() {
  if (_mailer === null) {
    try {
      _mailer = createMailer() || false;
    } catch (err) {
      logger.warn({ err: err.message }, 'creditEngine: mailer init failed');
      _mailer = false;
    }
  }
  return _mailer || null;
}

async function notify({ to, subject, html, text, channel = 'email' }) {
  // Every notification path catches its own errors. A failed notification
  // must NEVER prevent a hold from being placed or released. The caller does
  // not await the result for blocking decisions.
  try {
    if (!to || (Array.isArray(to) && !to.length)) return { sent: false, skipped: 'no-recipient' };
    const mailer = getMailer();
    if (!mailer) return { sent: false, skipped: 'no-mailer' };
    await mailer.sendMail({ to, subject, html, text });
    return { sent: true };
  } catch (err) {
    logger.warn({ err: err.message, subject, channel }, 'creditEngine: notification failed');
    return { sent: false, error: err.message };
  }
}

async function notifySalesRepAndAR(customer, subject, body) {
  const recipients = [];
  // Sales rep on the customer record (best-effort — column may not exist
  // in every deployment, the spread tolerates undefined).
  if (customer?.sales_rep_email) recipients.push(customer.sales_rep_email);
  if (customer?.assigned_rep_email) recipients.push(customer.assigned_rep_email);

  // AR manager — looked up from users table.
  try {
    const { data: arUsers } = await supabase
      .from('users')
      .select('email,role')
      .in('role', ['admin', 'manager']);
    (arUsers || []).forEach((u) => { if (u.email) recipients.push(u.email); });
  } catch (err) {
    logger.warn({ err: err.message }, 'creditEngine: failed to look up AR recipients');
  }

  const unique = [...new Set(recipients.filter(Boolean))];
  if (!unique.length) return { sent: false, skipped: 'no-recipients' };
  return notify({ to: unique, subject, text: body });
}

// ── Audit log ──────────────────────────────────────────────────────────────
async function logEvent(entry) {
  // Append-only. We intentionally never await on the response path for
  // critical decisions — the caller can `await` if it needs the row id.
  try {
    const row = {
      customer_id: entry.customer_id,
      event_type: entry.event_type,
      previous_status: entry.previous_status || null,
      new_status: entry.new_status || null,
      previous_credit_limit: entry.previous_credit_limit ?? null,
      new_credit_limit: entry.new_credit_limit ?? null,
      previous_credit_terms: entry.previous_credit_terms || null,
      new_credit_terms: entry.new_credit_terms || null,
      customer_balance_at_event: entry.balance ?? null,
      triggered_by: entry.triggered_by || 'system_auto',
      performed_by: entry.performed_by || null,
      order_id: entry.order_id ? String(entry.order_id) : null,
      invoice_id: entry.invoice_id ? String(entry.invoice_id) : null,
      override_reason: entry.override_reason || null,
      notes: entry.notes || null,
      company_id: entry.company_id || null,
      location_id: entry.location_id || null,
    };
    const { data, error } = await supabase.from('credit_hold_log').insert([row]).select().single();
    if (error) {
      logger.error({ err: error.message, event: entry.event_type, customer_id: entry.customer_id }, 'creditEngine: log insert failed');
      return null;
    }
    return data;
  } catch (err) {
    logger.error({ err: err.message }, 'creditEngine: log insert threw');
    return null;
  }
}

// ── Customer + invoice fetch helpers ───────────────────────────────────────
// BE-002: all three lookups accept an optional request context and scope the
// query to the caller's tenant via scopeQueryByContext. Without context
// (system cron paths) behavior is unchanged.
async function getCustomer(customerId, context = null) {
  let query = supabase
    .from('Customers')
    .select('*')
    .eq('id', customerId);
  if (context) query = scopeQueryByContext(query, context);
  const { data, error } = await query.single();
  if (error || !data) throw new Error(`Customer ${customerId}: ${error ? error.message : 'not found'}`);
  return data;
}

async function findCustomerByName(customerName, context = null) {
  if (!customerName) return null;
  // BE-002: escape LIKE metacharacters so a name like "100%" matches
  // literally instead of acting as a wildcard.
  let query = supabase
    .from('Customers')
    .select('*')
    .ilike('company_name', escapeLike(String(customerName).trim()));
  if (context) query = scopeQueryByContext(query, context);
  const { data, error } = await query.limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length ? data[0] : null;
}

// Fetch open invoices for a customer using both the FK and the denormalized
// name (legacy invoices may carry only customer_name). Two parallel queries
// merged by id avoids supabase .or() parser fragility with names that contain
// commas, dots, or quotes.
async function fetchOpenInvoicesForCustomer(customer_id, company_name, context = null) {
  const scoped = (query) => (context ? scopeQueryByContext(query, context) : query);
  const queries = [
    scoped(
      supabase
        .from('invoices')
        .select('id, total, due_date, invoice_date, created_at, status')
        .in('status', OPEN_INVOICE_STATUSES)
        .eq('customer_id', customer_id)
    ),
  ];
  if (company_name) {
    queries.push(
      scoped(
        supabase
          .from('invoices')
          .select('id, total, due_date, invoice_date, created_at, status')
          .in('status', OPEN_INVOICE_STATUSES)
          .eq('customer_name', company_name)
      )
    );
  }
  const results = await Promise.all(queries);
  const byId = new Map();
  for (const result of results) {
    if (result.error) throw new Error(`Invoices for customer ${customer_id}: ${result.error.message}`);
    for (const inv of result.data || []) byId.set(inv.id, inv);
  }
  return [...byId.values()];
}

// ── 2A. calculateCustomerBalance ───────────────────────────────────────────
async function calculateCustomerBalance(customer_id, context = null) {
  const customer = await getCustomer(customer_id, context);
  const unpaidRows = await fetchOpenInvoicesForCustomer(customer_id, customer.company_name, context);
  const unpaidTotal = unpaidRows.reduce((sum, inv) => sum + toCents(inv.total), 0);

  // Unapplied portal credits (best-effort — some deployments lack this table).
  let unappliedCredits = 0;
  try {
    const { data: credits } = await supabase
      .from('customer_credits')
      .select('amount, applied_amount')
      .eq('customer_id', customer_id);
    if (Array.isArray(credits)) {
      unappliedCredits = credits.reduce((sum, c) => {
        const remaining = toCents(c.amount) - toCents(c.applied_amount || 0);
        return sum + (remaining > 0 ? remaining : 0);
      }, 0);
    }
  } catch {
    unappliedCredits = 0;
  }

  const netCents = unpaidTotal - unappliedCredits;
  const balance = toMoney(netCents / 100);

  const oldestUnpaid = unpaidRows
    .map((inv) => inv.due_date || inv.invoice_date || inv.created_at)
    .filter(Boolean)
    .sort()[0] || null;

  // Persist on Customers
  await supabase
    .from('Customers')
    .update({
      current_balance: balance,
      oldest_unpaid_invoice_date: oldestUnpaid ? new Date(oldestUnpaid).toISOString().slice(0, 10) : null,
    })
    .eq('id', customer_id);

  return {
    current_balance: balance,
    unpaid_invoice_count: unpaidRows.length,
    oldest_unpaid_date: oldestUnpaid,
    unapplied_credits: toMoney(unappliedCredits / 100),
  };
}

// ── 2B. checkCreditStatus ──────────────────────────────────────────────────
async function checkCreditStatus(customer_id, context = null) {
  const customer = await getCustomer(customer_id, context);
  const limit = customer.credit_limit == null ? null : toMoney(customer.credit_limit);
  const balance = toMoney(customer.current_balance || 0);
  const warnPct = toMoney(customer.warning_threshold_pct ?? 80);
  const terms = effectiveTerms(customer);
  const days = termDays(terms);

  // ── Check 1: OVER LIMIT (limit > 0; null limit = unlimited credit) ──
  if (limit !== null && limit > 0 && balance >= limit) {
    return {
      should_hold: true,
      current_status: 'hold',
      reason: 'over_limit',
      balance,
      limit,
      terms,
      oldest_past_due_days: 0,
      days_until_next_invoice_due: 0,
    };
  }

  // ── Check 2: PAST DUE ──
  // For COD/PREPAY (days === 0) any unpaid invoice past invoice_date is overdue.
  const openInvoices = await fetchOpenInvoicesForCustomer(customer_id, customer.company_name, context);

  const now = Date.now();
  let oldestPastDueDays = 0;
  let nextDueInDays = Infinity;

  for (const inv of openInvoices) {
    const issued = inv.invoice_date || inv.created_at;
    const due = inv.due_date
      || (issued && days != null ? new Date(new Date(issued).getTime() + days * 86_400_000).toISOString() : null);
    if (!due) continue;
    const overdue = Math.floor((now - new Date(due).getTime()) / 86_400_000);
    if (overdue > 0 && overdue > oldestPastDueDays) oldestPastDueDays = overdue;
    if (overdue <= 0 && -overdue < nextDueInDays) nextDueInDays = -overdue;
  }

  if (oldestPastDueDays > 0) {
    return {
      should_hold: true,
      current_status: 'hold',
      reason: 'past_due',
      balance,
      limit,
      terms,
      oldest_past_due_days: oldestPastDueDays,
      days_until_next_invoice_due: nextDueInDays === Infinity ? null : nextDueInDays,
    };
  }

  // ── Check 3: WARNING ──
  if (limit !== null && limit > 0) {
    const threshold = toMoney((limit * warnPct) / 100);
    if (balance >= threshold) {
      return {
        should_hold: false,
        current_status: 'warning',
        reason: null,
        balance,
        limit,
        terms,
        oldest_past_due_days: 0,
        days_until_next_invoice_due: nextDueInDays === Infinity ? null : nextDueInDays,
      };
    }
  }

  // ── Check 4: GOOD ──
  return {
    should_hold: false,
    current_status: 'good',
    reason: null,
    balance,
    limit,
    terms,
    oldest_past_due_days: 0,
    days_until_next_invoice_due: nextDueInDays === Infinity ? null : nextDueInDays,
  };
}

// ── 2C. applyHold ──────────────────────────────────────────────────────────
async function applyHold(customer_id, reason, placed_by, notes, triggered_by = 'system_auto', context = {}) {
  const before = await getCustomer(customer_id);
  if (before.credit_hold === true && before.credit_status === 'hold') {
    // Already on hold — just refresh metadata and log a re-affirm event.
    return before;
  }

  const placedAt = new Date().toISOString();
  const update = {
    credit_hold: true,
    credit_hold_reason: reason,
    credit_hold_placed_at: placedAt,
    hold_placed_by: placed_by || null,
    hold_notes: notes || null,
    credit_status: 'hold',
  };

  const { data: updated, error } = await supabase
    .from('Customers')
    .update(update)
    .eq('id', customer_id)
    .select()
    .single();
  if (error) throw new Error(`applyHold(${customer_id}): ${error.message}`);

  await logEvent({
    customer_id,
    event_type: 'hold_placed',
    previous_status: before.credit_status || 'good',
    new_status: 'hold',
    balance: before.current_balance,
    triggered_by,
    performed_by: placed_by,
    notes: notes || HOLD_REASON_LABELS[reason] || reason,
    company_id: context.activeCompanyId || context.companyId,
    location_id: context.activeLocationId || context.locationId,
  });

  // Fire-and-forget notification.
  const subject = `🔴 Credit Hold Placed: ${updated.company_name || `Customer #${customer_id}`}`;
  const body = [
    `Customer: ${updated.company_name || ''}`,
    `Reason: ${HOLD_REASON_LABELS[reason] || reason}`,
    `Current balance: $${toMoney(updated.current_balance || 0).toFixed(2)}`,
    `Credit limit: ${updated.credit_limit == null ? 'unlimited' : `$${toMoney(updated.credit_limit).toFixed(2)}`}`,
    updated.oldest_unpaid_invoice_date ? `Oldest unpaid invoice: ${updated.oldest_unpaid_invoice_date}` : null,
    notes ? `Notes: ${notes}` : null,
  ].filter(Boolean).join('\n');
  notifySalesRepAndAR(updated, subject, body).catch(() => {});

  return updated;
}

// ── 2D. releaseHold ────────────────────────────────────────────────────────
async function releaseHold(customer_id, released_by, notes, triggered_by = 'manager_manual', context = {}) {
  const before = await getCustomer(customer_id);
  if (!before.credit_hold) return before;

  const update = {
    credit_hold: false,
    credit_hold_reason: null,
    credit_hold_placed_at: null,
    hold_placed_by: null,
    hold_notes: null,
    credit_status: 'good',
  };

  const { data: updated, error } = await supabase
    .from('Customers')
    .update(update)
    .eq('id', customer_id)
    .select()
    .single();
  if (error) throw new Error(`releaseHold(${customer_id}): ${error.message}`);

  await logEvent({
    customer_id,
    event_type: triggered_by === 'payment_received' ? 'auto_released' : 'hold_released',
    previous_status: 'hold',
    new_status: 'good',
    balance: before.current_balance,
    triggered_by,
    performed_by: released_by,
    notes: notes || null,
    company_id: context.activeCompanyId || context.companyId,
    location_id: context.activeLocationId || context.locationId,
  });

  const subject = `🟢 Credit Hold Released: ${updated.company_name || `Customer #${customer_id}`}`;
  const body = [
    `Customer: ${updated.company_name || ''}`,
    `Released by: ${triggered_by === 'payment_received' ? 'automatic (payment received)' : (released_by || 'manager')}`,
    `Current balance: $${toMoney(updated.current_balance || 0).toFixed(2)}`,
    notes ? `Notes: ${notes}` : null,
  ].filter(Boolean).join('\n');
  notifySalesRepAndAR(updated, subject, body).catch(() => {});

  return updated;
}

// ── Override resolution ────────────────────────────────────────────────────
async function findActiveOverride(customer_id, order_id) {
  if (!order_id) return null;
  const { data, error } = await supabase
    .from('credit_hold_overrides')
    .select('*')
    .eq('customer_id', customer_id)
    .eq('order_id', String(order_id))
    .is('consumed_at', null);
  if (error) return null;
  const now = Date.now();
  const valid = (data || []).find((o) => {
    if (o.expires_at && new Date(o.expires_at).getTime() < now) return false;
    return true;
  });
  return valid || null;
}

// ── 2E. checkOrderAllowed ──────────────────────────────────────────────────
// BE-002: pass `context` (req.context) so customer resolution is scoped to
// the requesting tenant. Without it, a name lookup could match another
// company's customer and echo their balance/credit-limit/hold-reason in the
// 402 response.
async function checkOrderAllowed({ customer_id, customer_name, order_id, order_total, context = null }) {
  let customer = null;
  if (customer_id) {
    try { customer = await getCustomer(customer_id, context); } catch { customer = null; }
  }
  if (!customer && customer_name) {
    customer = await findCustomerByName(customer_name, context);
  }
  if (!customer) {
    // Unknown customer — let it through; this is not a credit decision.
    return { allowed: true, unknown_customer: true };
  }

  // If on hold, check for an override.
  if (customer.credit_hold === true) {
    const override = await findActiveOverride(customer.id, order_id);
    if (!override) {
      return {
        allowed: false,
        reason: 'on_credit_hold',
        hold_reason: customer.credit_hold_reason || null,
        customer_id: customer.id,
        customer_name: customer.company_name,
        current_balance: toMoney(customer.current_balance || 0),
        credit_limit: customer.credit_limit == null ? null : toMoney(customer.credit_limit),
        oldest_past_due_days: customer.oldest_unpaid_invoice_date
          ? Math.max(0, daysBetween(new Date(), customer.oldest_unpaid_invoice_date))
          : 0,
        contact_for_override: 'AR manager',
      };
    }
    // Override exists — allow and let caller mark it consumed after the order lands.
    return {
      allowed: true,
      override_id: override.id,
      reason_override: 'manager_override',
      customer_id: customer.id,
      customer_name: customer.company_name,
    };
  }

  // Would this specific order push the customer over the limit?
  const limit = customer.credit_limit == null ? null : toMoney(customer.credit_limit);
  const balance = toMoney(customer.current_balance || 0);
  const orderTotalMoney = toMoney(order_total || 0);

  if (limit !== null && limit > 0) {
    const projected = toMoney(balance + orderTotalMoney);
    if (toCents(projected) > toCents(limit)) {
      return {
        allowed: false,
        reason: 'would_exceed_limit',
        customer_id: customer.id,
        customer_name: customer.company_name,
        current_balance: balance,
        order_total: orderTotalMoney,
        projected_balance: projected,
        credit_limit: limit,
        over_by: toMoney(projected - limit),
      };
    }

    const warnPct = toMoney(customer.warning_threshold_pct ?? 80);
    const threshold = toMoney((limit * warnPct) / 100);
    if (toCents(projected) >= toCents(threshold)) {
      return {
        allowed: true,
        warning: true,
        message: `${customer.company_name} is near credit limit`,
        customer_id: customer.id,
        customer_name: customer.company_name,
        current_balance: balance,
        projected_balance: projected,
        credit_limit: limit,
        available_credit: toMoney(limit - projected),
      };
    }
  }

  return { allowed: true, customer_id: customer.id, customer_name: customer.company_name };
}

async function consumeOverride(override_id) {
  if (!override_id) return;
  try {
    await supabase
      .from('credit_hold_overrides')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', override_id)
      .is('consumed_at', null);
  } catch (err) {
    logger.warn({ err: err.message, override_id }, 'creditEngine: consumeOverride failed');
  }
}

async function logOrderBlocked(customer_id, order_total, decision, context = {}) {
  await logEvent({
    customer_id,
    event_type: 'order_blocked',
    new_status: decision.reason === 'on_credit_hold' ? 'hold' : 'over_limit_block',
    balance: decision.current_balance,
    triggered_by: 'system_auto',
    notes: decision.reason === 'would_exceed_limit'
      ? `Order $${(decision.order_total || 0).toFixed(2)} would push balance to $${(decision.projected_balance || 0).toFixed(2)} vs limit $${(decision.credit_limit || 0).toFixed(2)}`
      : `Order blocked: customer on credit hold (${decision.hold_reason || 'unknown'})`,
    company_id: context.activeCompanyId || context.companyId,
    location_id: context.activeLocationId || context.locationId,
  });
}

// ── 2F. runScheduledCreditCheck ────────────────────────────────────────────
async function runScheduledCreditCheck() {
  const startedAt = Date.now();
  const summary = {
    customers_checked: 0,
    holds_placed: 0,
    holds_released: 0,
    warnings_issued: 0,
    errors: 0,
    started_at: new Date(startedAt).toISOString(),
  };

  // Pull customers in pages — Supabase will cap responses at 1000 by default.
  // BE-007: keyset pagination on the raw id value (no numeric coercion) —
  // the previous cursor=0 / .gte / Number(id)+1 pattern silently truncated
  // to one page whenever ids were not numeric.
  const pageSize = 500;
  let cursor = null;
  while (true) {
    let pageQuery = supabase
      .from('Customers')
      .select('id, company_name, credit_hold, credit_status, auto_hold_enabled, credit_limit')
      .order('id', { ascending: true })
      .limit(pageSize);
    if (cursor != null) pageQuery = pageQuery.gt('id', cursor);
    const { data: page, error } = await pageQuery;
    if (error) {
      logger.error({ err: error.message }, 'runScheduledCreditCheck: customer fetch failed');
      break;
    }
    if (!page || !page.length) break;

    for (const customer of page) {
      try {
        summary.customers_checked += 1;
        await calculateCustomerBalance(customer.id);
        const status = await checkCreditStatus(customer.id);

        const wasOnHold = customer.credit_hold === true;
        const shouldBeOnHold = status.should_hold && (customer.auto_hold_enabled !== false);

        if (shouldBeOnHold && !wasOnHold) {
          await applyHold(customer.id, status.reason, null, `Auto-hold: ${status.reason}`, 'system_auto');
          summary.holds_placed += 1;
        } else if (!status.should_hold && wasOnHold && customer.credit_hold_reason !== 'manual') {
          await releaseHold(customer.id, null, 'Auto-release: criteria cleared', 'system_auto');
          summary.holds_released += 1;
        } else if (status.current_status === 'warning' && customer.credit_status !== 'warning') {
          await supabase
            .from('Customers')
            .update({ credit_status: 'warning', credit_reviewed_at: new Date().toISOString() })
            .eq('id', customer.id);
          await logEvent({
            customer_id: customer.id,
            event_type: 'warning_issued',
            previous_status: customer.credit_status || 'good',
            new_status: 'warning',
            balance: status.balance,
            triggered_by: 'scheduled_check',
          });
          summary.warnings_issued += 1;
        }
      } catch (err) {
        summary.errors += 1;
        logger.warn({ err: err.message, customer_id: customer.id }, 'runScheduledCreditCheck: customer error');
      }
    }

    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
    if (cursor == null) break;
  }

  summary.duration_ms = Date.now() - startedAt;
  summary.finished_at = new Date().toISOString();
  logger.info(summary, 'runScheduledCreditCheck complete');
  return summary;
}

// ── 2G. autoReleaseCheck ───────────────────────────────────────────────────
async function autoReleaseCheck(customer_id, options = {}) {
  if (!customer_id) return null;
  try {
    await calculateCustomerBalance(customer_id);
    const customer = await getCustomer(customer_id);

    // Only auto-release a hold that was placed automatically. Manual holds
    // stay until a manager clears them — that's the entire point of the
    // "manual" reason. Auto holds came from us; we own clearing them.
    if (customer.credit_hold && customer.credit_hold_reason !== 'manual') {
      const status = await checkCreditStatus(customer_id);
      if (!status.should_hold) {
        return releaseHold(
          customer_id,
          options.released_by || null,
          options.notes || 'Auto-release: balance cleared',
          'payment_received'
        );
      }
    }

    // Even if no hold to release, refresh credit_status (warning ⇄ good).
    const status = await checkCreditStatus(customer_id);
    if (customer.credit_status !== status.current_status && !customer.credit_hold) {
      await supabase
        .from('Customers')
        .update({ credit_status: status.current_status, credit_reviewed_at: new Date().toISOString() })
        .eq('id', customer_id);
    }
    return customer;
  } catch (err) {
    logger.warn({ err: err.message, customer_id }, 'autoReleaseCheck failed');
    return null;
  }
}

// Recalculate after a new invoice is created. Returns whether status changed.
async function reactToInvoiceCreated(customer_id, invoice_id, context = {}) {
  if (!customer_id) return null;
  try {
    await calculateCustomerBalance(customer_id);
    const customer = await getCustomer(customer_id);
    const status = await checkCreditStatus(customer_id);
    const wasOnHold = customer.credit_hold === true;

    if (status.should_hold && !wasOnHold && customer.auto_hold_enabled !== false) {
      await applyHold(customer_id, status.reason, null, `Triggered by invoice ${invoice_id}`, 'invoice_created', context);
      return 'hold_placed';
    }

    if (status.current_status === 'warning' && customer.credit_status !== 'warning') {
      await supabase
        .from('Customers')
        .update({ credit_status: 'warning' })
        .eq('id', customer_id);
      await logEvent({
        customer_id,
        event_type: 'warning_issued',
        previous_status: customer.credit_status || 'good',
        new_status: 'warning',
        balance: status.balance,
        triggered_by: 'invoice_created',
        invoice_id,
        company_id: context.activeCompanyId || context.companyId,
        location_id: context.activeLocationId || context.locationId,
      });
      return 'warning_issued';
    }
    return 'no_change';
  } catch (err) {
    logger.warn({ err: err.message, customer_id, invoice_id }, 'reactToInvoiceCreated failed');
    return null;
  }
}

// Update payment statistics after an invoice is marked paid.
async function recordPaymentReceived({ customer_id, customer_name, invoice, amount }) {
  let resolvedCustomerId = customer_id;
  if (!resolvedCustomerId && customer_name) {
    const found = await findCustomerByName(customer_name);
    resolvedCustomerId = found?.id || null;
  }
  if (!resolvedCustomerId) return null;

  try {
    const customer = await getCustomer(resolvedCustomerId);
    const now = new Date();
    const updates = {
      last_payment_date: now.toISOString().slice(0, 10),
      last_payment_amount: toMoney(amount || invoice?.total || 0),
    };

    if (invoice?.invoice_date || invoice?.created_at) {
      const issued = new Date(invoice.invoice_date || invoice.created_at);
      const daysToPay = Math.max(0, Math.floor((now.getTime() - issued.getTime()) / 86_400_000));
      const prevAvg = parseInt(customer.avg_days_to_pay || 0, 10);
      const prevCount = parseInt(customer.payment_count || 0, 10);
      const nextCount = prevCount + 1;
      updates.avg_days_to_pay = Math.round((prevAvg * prevCount + daysToPay) / nextCount);
      updates.payment_count = nextCount;
    }

    let updateQuery = supabase.from('Customers').update(updates).eq('id', resolvedCustomerId);
    if (invoice?.company_id) updateQuery = updateQuery.eq('company_id', invoice.company_id);
    if (invoice?.location_id) updateQuery = updateQuery.eq('location_id', invoice.location_id);
    await updateQuery;
    return autoReleaseCheck(resolvedCustomerId, { notes: `Payment of $${toMoney(amount || 0).toFixed(2)} received` });
  } catch (err) {
    logger.warn({ err: err.message, customer_id: resolvedCustomerId }, 'recordPaymentReceived failed');
    return null;
  }
}

module.exports = {
  // Money helpers (exposed for tests / consistency)
  toMoney,
  toCents,
  termDays,
  // Core API
  calculateCustomerBalance,
  checkCreditStatus,
  applyHold,
  releaseHold,
  checkOrderAllowed,
  consumeOverride,
  logOrderBlocked,
  runScheduledCreditCheck,
  autoReleaseCheck,
  reactToInvoiceCreated,
  recordPaymentReceived,
  logEvent,
  // Constants
  OPEN_INVOICE_STATUSES,
  PAID_INVOICE_STATUSES,
  HOLD_REASON_LABELS,
};
