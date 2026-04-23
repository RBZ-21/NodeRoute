const crypto = require('crypto');

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

function isStripeConfigured() {
  return !!STRIPE_SECRET_KEY;
}

function isStripeWebhookConfigured() {
  return !!STRIPE_WEBHOOK_SECRET;
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
  if (!STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY.');
  }

  const headers = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
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
    fields[`payment_intent_data[metadata][${key}]`] = value;
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

async function createCheckoutSession({ customerId, amount, currency = 'usd', successUrl, cancelUrl, metadata = {} }) {
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
    'payment_method_types[0]': 'card',
    'payment_method_types[1]': 'us_bank_account',
  };

  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null || value === '') continue;
    fields[`metadata[${key}]`] = value;
  }

  return stripeRequest('/checkout/sessions', { method: 'POST', fields });
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header');

  const parts = String(signatureHeader || '').split(',').reduce((acc, part) => {
    const [k, v] = part.split('=', 2);
    if (k && v) {
      if (!acc[k]) acc[k] = [];
      acc[k].push(v);
    }
    return acc;
  }, {});

  const timestamp = parts.t && parts.t[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) throw new Error('Invalid Stripe-Signature header');

  const payloadToSign = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payloadToSign, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const isValid = signatures.some((signature) => {
    const candidate = Buffer.from(String(signature), 'utf8');
    if (candidate.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(candidate, expectedBuf);
  });

  if (!isValid) throw new Error('Invalid Stripe webhook signature');
  return true;
}

module.exports = {
  isStripeConfigured,
  isStripeWebhookConfigured,
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
  verifyWebhookSignature,
};
