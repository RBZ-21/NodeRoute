'use strict';
/**
 * Stripe service helpers.
 *
 * verifyWebhookSignature — validates the Stripe-Signature header and rejects
 * payloads with missing, non-numeric, or stale timestamps before Stripe's own
 * library can parse them. This prevents replay attacks and forged events.
 *
 * The payment helpers (customers, payment methods, intents, checkout) call
 * Stripe's REST API directly with the secret key. They are consumed by the
 * customer-portal payment routes via routes/portal/payments-shared.js —
 * tests/stripe-service-contract.test.js pins this module's export surface so
 * a refactor can never silently drop a function the routes depend on again.
 */
const config = require('../lib/config');

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2026-02-25.clover';

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

function isStripeConfigured() {
  return !!stripeSecretKey();
}

function stripeKeyMode(key) {
  const normalized = String(key || '').trim();
  if (!normalized) return 'missing';
  if (normalized.startsWith('sk_test_') || normalized.startsWith('pk_test_')) return 'test';
  if (normalized.startsWith('sk_live_') || normalized.startsWith('pk_live_')) return 'live';
  return 'unknown';
}

function stripeSecretKeyMode() {
  return stripeKeyMode(stripeSecretKey());
}

function isStripeTestMode() {
  return stripeSecretKeyMode() === 'test';
}

let _client = null;
function getClient() {
  const Stripe = require('stripe');
  if (!_client) _client = new Stripe(stripeSecretKey(), { apiVersion: STRIPE_API_VERSION });
  return _client;
}

function normalizeAmountToCents(amount) {
  const cents = Math.round((parseFloat(amount || 0) || 0) * 100);
  return Math.max(0, cents);
}

function toFormBody(fields = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  return params;
}

async function stripeRequest(path, { method = 'GET', fields = null, idempotencyKey = null } = {}) {
  const secretKey = stripeSecretKey();
  if (!secretKey) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY.');
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };

  const init = { method, headers };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (fields && method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = toFormBody(fields);
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.stripe = payload?.error || null;
    throw err;
  }
  return payload;
}

async function findOrCreateCustomer({ email, name = null, metadata = {} }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Customer email is required for Stripe customer lookup');

  const list = await stripeRequest(`/customers?email=${encodeURIComponent(normalizedEmail)}&limit=1`);
  const existing = Array.isArray(list?.data) ? list.data[0] : null;
  if (existing) return existing;

  const fields = { email: normalizedEmail };
  if (name) fields.name = String(name).trim();
  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null || value === '') continue;
    fields[`metadata[${key}]`] = value;
  }
  return stripeRequest('/customers', { method: 'POST', fields });
}

function paymentMethodTypeForPortalType(methodType) {
  return methodType === 'ach_bank' ? 'us_bank_account' : 'card';
}

function portalMethodTypeForStripeType(stripeType) {
  if (stripeType === 'us_bank_account') return 'ach_bank';
  return 'debit_card';
}

async function createSetupIntent({ customerId, methodType = 'debit_card', metadata = {} }) {
  const stripePmType = paymentMethodTypeForPortalType(methodType);
  const fields = {
    customer: customerId,
    usage: 'off_session',
    'payment_method_types[0]': stripePmType,
  };

  if (stripePmType === 'us_bank_account') {
    fields['payment_method_options[us_bank_account][verification_method]'] = 'automatic';
  }

  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null || value === '') continue;
    fields[`metadata[${key}]`] = value;
  }

  return stripeRequest('/setup_intents', { method: 'POST', fields });
}

async function retrievePaymentMethod(paymentMethodId) {
  if (!paymentMethodId) throw new Error('paymentMethodId is required');
  return stripeRequest(`/payment_methods/${encodeURIComponent(paymentMethodId)}`);
}

async function attachPaymentMethod({ paymentMethodId, customerId }) {
  if (!paymentMethodId || !customerId) throw new Error('paymentMethodId and customerId are required');
  return stripeRequest(`/payment_methods/${encodeURIComponent(paymentMethodId)}/attach`, {
    method: 'POST',
    fields: { customer: customerId },
  });
}

async function detachPaymentMethod(paymentMethodId) {
  if (!paymentMethodId) throw new Error('paymentMethodId is required');
  return stripeRequest(`/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`, { method: 'POST', fields: {} });
}

async function createPaymentIntent({ amount, currency = 'usd', customerId, paymentMethodId, description = null, metadata = {}, offSession = true, confirm = true, idempotencyKey = null }) {
  const amountCents = normalizeAmountToCents(amount);
  if (!amountCents) throw new Error('Payment amount must be greater than zero');
  if (!customerId) throw new Error('customerId is required');

  const fields = {
    amount: amountCents,
    currency,
    customer: customerId,
    confirm: confirm ? 'true' : 'false',
  };

  if (paymentMethodId) fields.payment_method = paymentMethodId;
  if (offSession) fields.off_session = 'true';
  if (description) fields.description = description;

  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null || value === '') continue;
    fields[`metadata[${key}]`] = value;
  }

  return stripeRequest('/payment_intents', {
    method: 'POST',
    fields,
    idempotencyKey,
  });
}

async function createCheckoutSession({
  customerId,
  amount,
  currency = 'usd',
  successUrl,
  cancelUrl,
  metadata = {},
  clientReferenceId = null,
  idempotencyKey = null,
}) {
  const amountCents = normalizeAmountToCents(amount);
  if (!amountCents) throw new Error('Checkout amount must be greater than zero');
  if (!successUrl || !cancelUrl) throw new Error('successUrl and cancelUrl are required for checkout');

  const fields = {
    mode: 'payment',
    customer: customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': amountCents,
    'line_items[0][price_data][product_data][name]': 'NodeRoute Portal Balance Payment',
    'line_items[0][quantity]': 1,
  };
  if (clientReferenceId) fields.client_reference_id = clientReferenceId;

  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null || value === '') continue;
    fields[`metadata[${key}]`] = value;
  }

  return stripeRequest('/checkout/sessions', { method: 'POST', fields, idempotencyKey });
}

async function createSubscriptionCheckoutSession({
  customerId,
  priceId,
  successUrl,
  cancelUrl,
  metadata = {},
  subscriptionMetadata = {},
  clientReferenceId = null,
  idempotencyKey = null,
}) {
  const normalizedPriceId = String(priceId || '').trim();
  if (!normalizedPriceId) throw new Error('Stripe recurring price id is required');
  if (!successUrl || !cancelUrl) throw new Error('successUrl and cancelUrl are required for checkout');

  const fields = {
    mode: 'subscription',
    customer: customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price]': normalizedPriceId,
    'line_items[0][quantity]': 1,
  };
  if (clientReferenceId) fields.client_reference_id = clientReferenceId;

  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null || value === '') continue;
    fields[`metadata[${key}]`] = value;
  }

  for (const [key, value] of Object.entries(subscriptionMetadata || {})) {
    if (value == null || value === '') continue;
    fields[`subscription_data[metadata][${key}]`] = value;
  }

  return stripeRequest('/checkout/sessions', { method: 'POST', fields, idempotencyKey });
}

/**
 * Parse and validate a raw Stripe-Signature header value.
 * Returns { t, signatures } or throws with a descriptive message.
 *
 * Rejects:
 *  - missing header
 *  - missing t= component
 *  - non-numeric timestamp
 *  - timestamp more than STRIPE_WEBHOOK_TOLERANCE_SECONDS in the past
 *  - timestamp more than STRIPE_WEBHOOK_TOLERANCE_SECONDS in the future (clock skew guard)
 */
function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing Stripe-Signature header');

  const parts = {};
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    parts[key] = val;
  }

  if (!parts.t) throw new Error('Stripe-Signature missing t= timestamp');

  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || isNaN(ts))
    throw new Error('Stripe-Signature t= is not a valid numeric timestamp');

  const nowSec  = Math.floor(Date.now() / 1000);
  const tolerance = config.STRIPE_WEBHOOK_TOLERANCE_SECONDS;
  const age      = nowSec - ts;

  if (age > tolerance)
    throw new Error(`Stripe webhook timestamp is stale (${age}s old, tolerance ${tolerance}s)`);
  if (age < -tolerance)
    throw new Error(`Stripe webhook timestamp is too far in the future (${Math.abs(age)}s, tolerance ${tolerance}s)`);

  // Delegate full signature verification to the official library
  return getClient().webhooks.constructEvent(rawBody, sigHeader, secret);
}

module.exports = {
  getClient,
  STRIPE_API_VERSION,
  verifyWebhookSignature,
  isStripeConfigured,
  isStripeTestMode,
  stripeKeyMode,
  stripeSecretKeyMode,
  normalizeAmountToCents,
  paymentMethodTypeForPortalType,
  portalMethodTypeForStripeType,
  findOrCreateCustomer,
  createSetupIntent,
  retrievePaymentMethod,
  attachPaymentMethod,
  detachPaymentMethod,
  createPaymentIntent,
  createCheckoutSession,
  createSubscriptionCheckoutSession,
};
