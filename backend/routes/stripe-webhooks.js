'use strict';
/**
 * Stripe webhook handler.
 *
 * Security guarantees:
 *  1. Idempotency  — every event id is stored in stripe_webhook_events;
 *     duplicate deliveries return {received:true,replay:true} without re-processing.
 *  2. Tenant scope — invoice metadata.company_id must match the invoice row's
 *     company_id before we mark anything paid.
 *  3. Amount match — paid amount must equal the invoice total or the signed
 *     portal checkout invoice set.
 *  4. Status guard — only payable unpaid invoice statuses are eligible.
 *  5. Timestamp    — stale / missing / non-numeric t= values are rejected
 *     before constructEvent (handled in services/stripe.js).
 *  6. Async intents — payment_intent.succeeded and payment_intent.payment_failed
 *     reconcile invoice state from PaymentIntent metadata.
 */
const { supabase } = require('../services/supabase');
const { hashInvoiceSet, parseInvoiceIds } = require('../lib/invoice-set-hash');
const { verifyWebhookSignature } = require('../services/stripe');
const arLedger = require('../services/ar-ledger');
const logger = require('../services/logger');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PAYABLE_INVOICE_STATUSES = new Set(['open', 'pending', 'signed', 'sent', 'delivered', 'overdue']);

/** Record this event id; return true if it is a fresh event, false if replay. */
async function claimEvent(eventId) {
  const { data: existing, error: existingError } = await supabase
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('event_id', eventId)
    .limit(1);
  if (existingError) throw existingError;
  if (Array.isArray(existing) && existing.length) return false;

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

function paymentIntentAmount(intent) {
  return cents(intent.amount_received || intent.amount || 0);
}

function paymentIntentFailureMessage(intent) {
  return (
    intent.last_payment_error?.message
    || intent.last_payment_error?.decline_code
    || intent.cancellation_reason
    || intent.status
    || 'Payment failed'
  );
}

function explicitBooleanEnv(...keys) {
  for (const key of keys) {
    if (process.env[key] === undefined) continue;
    const normalized = String(process.env[key] || '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return null;
}

function arStripeCardProcessingEnabled() {
  const explicit = explicitBooleanEnv(
    'NODEROUTE_AR_CARD_PAYMENTS_ENABLED',
    'AR_STRIPE_CARD_PAYMENTS_ENABLED',
    'CUSTOMER_AR_CARD_PAYMENTS_ENABLED'
  );
  if (explicit !== null) return explicit;
  return String(process.env.PORTAL_PAYMENT_ENABLED || '').toLowerCase() === 'true'
    && String(process.env.PORTAL_PAYMENT_PROVIDER || '').toLowerCase() === 'stripe';
}

function isCustomerArStripePayment(metadata = {}) {
  return String(metadata.noderoute_payment_scope || metadata.payment_scope || '').toLowerCase() === 'customer_ar';
}

function webhookContext(companyId, locationId) {
  return {
    companyId,
    activeCompanyId: companyId,
    locationId: locationId || null,
    activeLocationId: locationId || null,
  };
}

async function findStripeReceipt(companyId, stripePaymentRef) {
  const { data, error } = await supabase
    .from('cash_receipts')
    .select('*')
    .eq('company_id', companyId)
    .eq('stripe_payment_intent_id', stripePaymentRef)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function createStripeReceipt({ companyId, locationId, customerId, amount, stripePaymentRef }) {
  const existing = await findStripeReceipt(companyId, stripePaymentRef);
  if (existing) return existing;
  const { data, error } = await supabase
    .from('cash_receipts')
    .insert([{
      company_id: companyId,
      location_id: locationId || null,
      customer_id: String(customerId),
      receipt_date: new Date().toISOString().slice(0, 10),
      total_amount: amount,
      unapplied_amount: amount,
      payment_method: 'card',
      stripe_payment_intent_id: stripePaymentRef,
      idempotency_key: `stripe:${stripePaymentRef}`,
      status: 'new',
      created_at: new Date().toISOString(),
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function applyStripeReceiptToInvoices({ companyId, locationId, stripePaymentRef, invoices, amount }) {
  if (!arStripeCardProcessingEnabled()) {
    logger.info({ stripePaymentRef, company_id: companyId }, 'Customer AR Stripe card processing disabled — skipping AR receipt application');
    return null;
  }
  const invoiceRows = (invoices || []).filter((invoice) => invoice?.customer_id);
  if (!invoiceRows.length) {
    logger.info({ stripePaymentRef, company_id: companyId }, 'Stripe payment has no invoice customer_id — skipping AR receipt application');
    return null;
  }
  const customerId = invoiceRows[0].customer_id;
  if (invoiceRows.some((invoice) => String(invoice.customer_id) !== String(customerId))) {
    logger.warn({ stripePaymentRef, company_id: companyId }, 'Stripe payment spans multiple customer IDs — skipping AR receipt application');
    return null;
  }

  const receipt = await createStripeReceipt({
    companyId,
    locationId,
    customerId,
    amount,
    stripePaymentRef,
  });
  return arLedger.applyReceipt(receipt.id, invoiceRows.map((invoice) => ({
    invoice_id: invoice.id,
    applied_amount: Number(invoice.total || amount),
  })), { db: supabase, context: webhookContext(companyId, locationId) });
}

async function loadInvoiceForPaymentIntent(intent, eventType) {
  const { company_id, invoice_id, location_id } = intent.metadata || {};
  if (!invoice_id || !company_id) {
    logger.warn({ payment_intent_id: intent.id, eventType }, 'payment_intent webhook missing invoice_id or company_id metadata');
    return null;
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, total, company_id, location_id, customer_id, status, stripe_payment_intent_id')
    .eq('id', invoice_id)
    .single();
  if (error || !invoice) {
    logger.error({ invoice_id, payment_intent_id: intent.id, eventType }, 'payment_intent webhook invoice not found');
    return null;
  }

  if (String(invoice.company_id || '') !== String(company_id || '')) {
    logger.error({
      invoice_id,
      payment_intent_id: intent.id,
      metadata_company_id: company_id,
      invoice_company_id: invoice.company_id,
      eventType,
    }, 'Tenant scope violation on PaymentIntent invoice payment');
    return null;
  }

  if (location_id && invoice.location_id && String(invoice.location_id) !== String(location_id)) {
    logger.error({
      invoice_id,
      payment_intent_id: intent.id,
      metadata_location_id: location_id,
      invoice_location_id: invoice.location_id,
      eventType,
    }, 'Location scope violation on PaymentIntent invoice payment');
    return null;
  }

  return { invoice, company_id, invoice_id, location_id };
}

function scopedInvoiceUpdate(invoiceId, companyId, locationId, updates) {
  let query = supabase
    .from('invoices')
    .update(updates)
    .eq('id', invoiceId)
    .eq('company_id', companyId);
  if (locationId) query = query.eq('location_id', locationId);
  return query.select('id').single();
}

async function handleCheckoutSessionCompleted(session) {
  const {
    company_id,
    customer_email,
    invoice_hash,
    invoice_id,
    invoice_ids,
    checkout_type,
    location_id,
  } = session.metadata || {};
  const amountPaid = cents(session.amount_total || 0);

  if (checkout_type === 'portal_checkout') {
    const ids = parseInvoiceIds(invoice_ids);
    const uniqueIds = new Set(ids);
    if (!company_id || !customer_email || !invoice_hash || !ids.length || uniqueIds.size !== ids.length) {
      logger.warn({ session_id: session.id }, 'portal_checkout: missing or invalid signed invoice set metadata');
      return;
    }

    let query = supabase
      .from('invoices')
      .select('id,total,company_id,location_id,customer_id,customer_email,status')
      .eq('company_id', company_id)
      .ilike('customer_email', customer_email)
      .in('id', ids);
    if (location_id) query = query.eq('location_id', location_id);
    const { data: invoices, error } = await query;

    if (error) throw error;

    if (!Array.isArray(invoices) || invoices.length !== ids.length) {
      logger.warn({
        session_id: session.id,
        company_id,
        location_id,
        expected_count: ids.length,
        found_count: Array.isArray(invoices) ? invoices.length : 0,
      }, 'portal_checkout: invoice set no longer matches metadata — skipping');
      return;
    }

    if (invoices.some((invoice) => String(invoice.company_id || '') !== String(company_id || ''))) {
      logger.error({ company_id, session_id: session.id }, 'Tenant scope violation in portal_checkout');
      return;
    }

    if (location_id && invoices.some((invoice) => String(invoice.location_id || '') !== String(location_id || ''))) {
      logger.error({ company_id, location_id, session_id: session.id }, 'Location scope violation in portal_checkout');
      return;
    }

    if (invoices.some((invoice) => !PAYABLE_INVOICE_STATUSES.has(String(invoice.status || '').toLowerCase()))) {
      logger.info({ session_id: session.id, company_id }, 'portal_checkout: invoice set contains non-payable status — skipping');
      return;
    }

    const recomputedHash = hashInvoiceSet(invoices);
    if (recomputedHash !== invoice_hash) {
      logger.warn({ session_id: session.id, company_id }, 'portal_checkout: invoice hash mismatch — skipping');
      return;
    }

    const balance = invoices.reduce((s, inv) => s + Number(inv.total || 0), 0);
    if (Math.abs(amountPaid - balance) > 0.01) {
      logger.warn({ amountPaid, balance, company_id, session_id: session.id }, 'portal_checkout: paid amount does not match signed invoice set — skipping');
      return;
    }

    let updateQuery = supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        payment_status: 'paid',
        stripe_session_id: session.id,
      })
      .eq('company_id', company_id)
      .ilike('customer_email', customer_email)
      .in('id', ids)
      .in('status', Array.from(PAYABLE_INVOICE_STATUSES));
    if (location_id) updateQuery = updateQuery.eq('location_id', location_id);
    const { data: updatedInvoices, error: upErr } = await updateQuery.select('id');
    if (upErr) throw upErr;
    if (!Array.isArray(updatedInvoices) || updatedInvoices.length !== ids.length) {
      logger.warn({
        session_id: session.id,
        company_id,
        expected_count: ids.length,
        updated_count: Array.isArray(updatedInvoices) ? updatedInvoices.length : 0,
      }, 'portal_checkout: not all invoices were updated after final status guard');
      return;
    }
    if (isCustomerArStripePayment(session.metadata || {})) {
      await applyStripeReceiptToInvoices({
        companyId: company_id,
        locationId: location_id,
        stripePaymentRef: session.payment_intent || `checkout:${session.id}`,
        invoices,
        amount: amountPaid,
      });
    }
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
    .select('id, total, company_id, location_id, customer_id, status')
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
  if (location_id && inv.location_id && String(inv.location_id) !== String(location_id)) {
    logger.error({ invoice_id, location_id, inv_location: inv.location_id }, 'Location scope violation on invoice payment');
    return;
  }

  // Amount check
  const expected = Number(inv.total || 0);
  if (Math.abs(amountPaid - expected) > 0.01) {
    logger.warn({ amountPaid, expected, invoice_id }, 'checkout.session.completed: paid amount mismatch — skipping');
    return;
  }

  // Status check
  if (!PAYABLE_INVOICE_STATUSES.has(String(inv.status || '').toLowerCase())) {
    logger.info({ invoice_id, status: inv.status }, 'checkout.session.completed: invoice not in payable status — skipping');
    return;
  }

  const { error: upErr } = await scopedInvoiceUpdate(invoice_id, company_id, location_id, {
    status: 'paid',
    paid_at: new Date().toISOString(),
    payment_status: 'paid',
    stripe_session_id: session.id,
  });
  if (upErr) throw upErr;
  if (isCustomerArStripePayment(session.metadata || {})) {
    await applyStripeReceiptToInvoices({
      companyId: company_id,
      locationId: location_id,
      stripePaymentRef: session.payment_intent || `checkout:${session.id}`,
      invoices: [inv],
      amount: amountPaid,
    });
  }
  logger.info({ invoice_id }, 'checkout.session.completed: invoice marked paid');
}

async function handlePaymentIntentSucceeded(intent) {
  const resolved = await loadInvoiceForPaymentIntent(intent, 'payment_intent.succeeded');
  if (!resolved) return;
  const { invoice, company_id, invoice_id, location_id } = resolved;

  const invoiceStatus = String(invoice.status || '').toLowerCase();
  if (invoiceStatus !== 'paid' && !PAYABLE_INVOICE_STATUSES.has(invoiceStatus)) {
    logger.info({ invoice_id, status: invoice.status }, 'payment_intent.succeeded: invoice not in payable status — skipping');
    return;
  }

  const amountPaid = paymentIntentAmount(intent);
  const expected = Number(invoice.total || 0);
  if (Math.abs(amountPaid - expected) > 0.01) {
    logger.warn({ amountPaid, expected, invoice_id, payment_intent_id: intent.id }, 'payment_intent.succeeded: paid amount mismatch — skipping');
    return;
  }

  if (isCustomerArStripePayment(intent.metadata || {})) {
    await applyStripeReceiptToInvoices({
      companyId: company_id,
      locationId: location_id,
      stripePaymentRef: intent.id,
      invoices: [invoice],
      amount: amountPaid,
    });
  }

  if (invoiceStatus === 'paid') {
    logger.info({ invoice_id, payment_intent_id: intent.id }, 'payment_intent.succeeded: invoice already paid — AR receipt reconciled if applicable');
    return;
  }

  const paidAt = new Date().toISOString();
  const { error } = await scopedInvoiceUpdate(invoice_id, company_id, location_id, {
    status: 'paid',
    paid_at: paidAt,
    payment_status: 'paid',
    stripe_payment_intent_id: intent.id,
  });
  if (error) throw error;
  logger.info({ invoice_id, payment_intent_id: intent.id }, 'payment_intent.succeeded: invoice marked paid');
}

async function handlePaymentIntentFailed(intent) {
  const resolved = await loadInvoiceForPaymentIntent(intent, 'payment_intent.payment_failed');
  if (!resolved) return;
  const { invoice, company_id, invoice_id, location_id } = resolved;

  if (invoice.status === 'paid') {
    logger.info({ invoice_id, payment_intent_id: intent.id }, 'payment_intent.payment_failed: invoice already paid — skipping failed status');
    return;
  }

  const { error } = await scopedInvoiceUpdate(invoice_id, company_id, location_id, {
    payment_status: 'failed',
    payment_failed_at: new Date().toISOString(),
    payment_failure_reason: paymentIntentFailureMessage(intent),
    stripe_payment_intent_id: intent.id,
  });
  if (error) throw error;
  logger.warn({ invoice_id, payment_intent_id: intent.id, reason: paymentIntentFailureMessage(intent) }, 'payment_intent.payment_failed: invoice payment marked failed');
}

function billingInvoiceMetadata(invoice) {
  return (
    invoice.subscription_details?.metadata
    || invoice.parent?.subscription_details?.metadata
    || invoice.lines?.data?.find((line) => line.metadata?.company_id)?.metadata
    || invoice.metadata
    || {}
  );
}

// FIX [M9]: explicitly handle Stripe subscription invoice payments from NodeRoute billing checkout.
async function handleInvoicePaid(invoice) {
  const metadata = billingInvoiceMetadata(invoice);
  const source = String(metadata.source || '');
  const checkoutType = String(metadata.checkout_type || '');
  if (source !== 'noderoute_billing_checkout' && checkoutType !== 'noderoute_subscription') return;

  const companyId = String(metadata.company_id || '').trim();
  if (!companyId) {
    logger.warn({ stripe_invoice_id: invoice.id }, 'invoice.paid: NodeRoute billing invoice missing company_id metadata');
    return;
  }

  logger.info({
    company_id: companyId,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: invoice.subscription || invoice.parent?.subscription_details?.subscription || null,
    amount_paid: cents(invoice.amount_paid || 0),
  }, 'invoice.paid: NodeRoute subscription invoice paid');
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
    } else if (event.type === 'payment_intent.succeeded') {
      await handlePaymentIntentSucceeded(event.data.object);
    } else if (event.type === 'payment_intent.payment_failed') {
      await handlePaymentIntentFailed(event.data.object);
    } else if (event.type === 'invoice.paid') {
      await handleInvoicePaid(event.data.object);
    }
    res.json({ received: true });
  } catch (err) {
    logger.error({ err: err.message, event_id: event.id, type: event.type }, 'Stripe webhook processing error');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { stripeWebhookHandler };
