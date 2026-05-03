'use strict';
/**
 * Stripe webhook handler.
 *
 * Security guarantees:
 *  1. Idempotency  — every event id is stored in stripe_webhook_events;
 *     duplicate deliveries return {received:true,replay:true} without re-processing.
 *  2. Tenant scope — invoice metadata.company_id must match the invoice row's
 *     company_id before we mark anything paid.
 *  3. Amount match — paid amount must equal the invoice total (or the sum of
 *     all open invoices for portal_checkout sessions).
 *  4. Status guard — only 'open' or 'pending' invoices are eligible.
 *  5. Timestamp    — stale / missing / non-numeric t= values are rejected
 *     before constructEvent (handled in services/stripe.js).
 */
const { supabase } = require('../services/supabase');
const { verifyWebhookSignature } = require('../services/stripe');
const logger = require('../services/logger');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

/** Record this event id; return true if it is a fresh event, false if replay. */
async function claimEvent(eventId) {
  const { error } = await supabase
    .from('stripe_webhook_events')
    .insert({ event_id: eventId });
  // 23505 = unique_violation — already processed
  if (error && error.code === '23505') return false;
  if (error) throw error;
  return true;
}

/** Resolve cents → dollars rounded to 2dp. */
const cents = (n) => Math.round(n) / 100;

async function handleCheckoutSessionCompleted(session) {
  const { company_id, invoice_id, checkout_type } = session.metadata || {};
  const amountPaid = cents(session.amount_total || 0);

  if (checkout_type === 'portal_checkout') {
    // Portal checkout: pay the oldest open invoices up to the amount paid
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('id, total_amount, company_id, status')
      .eq('company_id', company_id)
      .in('status', ['open', 'pending'])
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Tenant scope check
    if (invoices.some(inv => inv.company_id !== company_id)) {
      logger.error({ company_id }, 'Tenant scope violation in portal_checkout');
      return;
    }

    // Aggregate balance check
    const balance = invoices.reduce((s, inv) => s + Number(inv.total_amount || 0), 0);
    if (Math.abs(amountPaid - balance) > 0.01) {
      logger.warn({ amountPaid, balance, company_id }, 'portal_checkout: paid amount does not match open balance — skipping');
      return;
    }

    const ids = invoices.map(i => i.id);
    const { error: upErr } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_session_id: session.id })
      .in('id', ids);
    if (upErr) throw upErr;
    logger.info({ count: ids.length, company_id }, 'portal_checkout: invoices marked paid');
    return;
  }

  // Single-invoice checkout
  if (!invoice_id || !company_id) {
    logger.warn({ session_id: session.id }, 'checkout.session.completed: missing invoice_id or company_id in metadata');
    return;
  }

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, total_amount, company_id, status')
    .eq('id', invoice_id)
    .single();

  if (invErr || !inv) {
    logger.error({ invoice_id }, 'checkout.session.completed: invoice not found');
    return;
  }

  // Tenant scope check
  if (inv.company_id !== company_id) {
    logger.error({ invoice_id, company_id, inv_company: inv.company_id }, 'Tenant scope violation on invoice payment');
    return;
  }

  // Amount check
  const expected = Number(inv.total_amount || 0);
  if (Math.abs(amountPaid - expected) > 0.01) {
    logger.warn({ amountPaid, expected, invoice_id }, 'checkout.session.completed: paid amount mismatch — skipping');
    return;
  }

  // Status check
  if (!['open', 'pending'].includes(inv.status)) {
    logger.info({ invoice_id, status: inv.status }, 'checkout.session.completed: invoice not in payable status — skipping');
    return;
  }

  const { error: upErr } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_session_id: session.id })
    .eq('id', invoice_id);
  if (upErr) throw upErr;
  logger.info({ invoice_id }, 'checkout.session.completed: invoice marked paid');
}

async function stripeWebhookHandler(req, res) {
  let event;
  try {
    event = verifyWebhookSignature(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err.message }, 'Stripe webhook signature verification failed');
    return res.status(400).json({ error: err.message });
  }

  // Idempotency — skip already-processed events
  let isFresh;
  try {
    isFresh = await claimEvent(event.id);
  } catch (err) {
    logger.error({ err: err.message, event_id: event.id }, 'Failed to record webhook event');
    return res.status(500).json({ error: 'Internal error recording event' });
  }

  if (!isFresh) {
    logger.info({ event_id: event.id, type: event.type }, 'Stripe webhook replay — skipping');
    return res.json({ received: true, replay: true });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(event.data.object);
    }
    // Add additional event type handlers here
    res.json({ received: true });
  } catch (err) {
    logger.error({ err: err.message, event_id: event.id, type: event.type }, 'Stripe webhook processing error');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { stripeWebhookHandler };
