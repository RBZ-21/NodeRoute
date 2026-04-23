const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabase } = require('../services/supabase');
const { buildInvoicePDF } = require('../services/pdf');
const { createConfiguredMailers } = require('../services/email');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');
const {
  isStripeConfigured,
  portalMethodTypeForStripeType,
  findOrCreateCustomer,
  createSetupIntent,
  retrievePaymentMethod,
  attachPaymentMethod,
  detachPaymentMethod,
  createPaymentIntent,
  createCheckoutSession,
} = require('../services/stripe');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';
const PORTAL_CODE_TTL_MS = Number(process.env.PORTAL_CODE_TTL_MS || 10 * 60 * 1000);
const PORTAL_MAX_VERIFY_ATTEMPTS = Number(process.env.PORTAL_MAX_VERIFY_ATTEMPTS || 5);
const PORTAL_RESEND_COOLDOWN_MS = Number(process.env.PORTAL_RESEND_COOLDOWN_MS || 60 * 1000);
const PORTAL_AUTH_RATE_WINDOW_MS = Number(process.env.PORTAL_AUTH_RATE_WINDOW_MS || 15 * 60 * 1000);
const PORTAL_AUTH_RATE_LIMIT = Number(process.env.PORTAL_AUTH_RATE_LIMIT || 5);
const PORTAL_PAYMENT_ENABLED = String(process.env.PORTAL_PAYMENT_ENABLED || 'false').toLowerCase() === 'true';
const PORTAL_PAYMENT_PROVIDER = String(process.env.PORTAL_PAYMENT_PROVIDER || 'manual').toLowerCase();
const PORTAL_PAYMENT_SUPPORT_EMAIL = process.env.PORTAL_PAYMENT_SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@noderoute.com';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const PORTAL_PAYMENT_CURRENCY = String(process.env.PORTAL_PAYMENT_CURRENCY || 'usd').toLowerCase();
const PORTAL_PAYMENT_STUB_CHECKOUT_URL = process.env.PORTAL_PAYMENT_STUB_CHECKOUT_URL || '';
const AUTOPAY_METHOD_TYPES = ['debit_card', 'ach_bank'];
const PORTAL_PREVIEW_EMAILS = String(process.env.PORTAL_PREVIEW_EMAILS || '').split(',').map(v => normalizeEmail(v)).filter(Boolean);
const portalChallenges = new Map();
const authAttempts = new Map();

function signPortalJWT(email, name, context = {}) {
  return jwt.sign(
    {
      email,
      name,
      role: 'customer',
      companyId: context.companyId || null,
      locationId: context.locationId || null,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function canUsePortalPreview(email) {
  const normalized = normalizeEmail(email);
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!normalized) return false;
  return normalized === adminEmail || PORTAL_PREVIEW_EMAILS.includes(normalized);
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCode(challengeId, code) {
  return crypto.createHash('sha256').update(`${challengeId}:${String(code || '').trim()}`).digest('hex');
}

function codesMatch(expectedHash, actualHash) {
  const expected = Buffer.from(String(expectedHash || ''), 'utf8');
  const actual = Buffer.from(String(actualHash || ''), 'utf8');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function pruneExpiredChallenges() {
  const now = Date.now();
  for (const [challengeId, challenge] of portalChallenges.entries()) {
    if (challenge.expiresAt <= now) portalChallenges.delete(challengeId);
  }
}

function touchRateLimitBucket(email) {
  const now = Date.now();
  const key = normalizeEmail(email);
  const bucket = authAttempts.get(key) || [];
  const fresh = bucket.filter((timestamp) => now - timestamp < PORTAL_AUTH_RATE_WINDOW_MS);
  fresh.push(now);
  authAttempts.set(key, fresh);
  return fresh.length;
}

function canRequestCode(email) {
  const key = normalizeEmail(email);
  const bucket = authAttempts.get(key) || [];
  const now = Date.now();
  const fresh = bucket.filter((timestamp) => now - timestamp < PORTAL_AUTH_RATE_WINDOW_MS);
  authAttempts.set(key, fresh);
  return fresh.length < PORTAL_AUTH_RATE_LIMIT;
}

async function resolvePortalCustomer(email) {
  const normalized = normalizeEmail(email);
  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .ilike('customer_email', normalized)
    .order('created_at', { ascending: false })
    .limit(1);
  if (invoiceError) throw invoiceError;
  if (invoices && invoices.length > 0) {
    return {
      email: normalized,
      name: invoices[0].customer_name || normalized,
      companyId: invoices[0].company_id || null,
      locationId: invoices[0].location_id || null,
    };
  }

  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .ilike('customer_email', normalized)
    .order('created_at', { ascending: false })
    .limit(1);
  if (orderError) throw orderError;
  if (orders && orders.length > 0) {
    return {
      email: normalized,
      name: orders[0].customer_name || normalized,
      companyId: orders[0].company_id || null,
      locationId: orders[0].location_id || null,
    };
  }

  if (canUsePortalPreview(normalized)) {
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .ilike('email', normalized)
      .limit(1);
    if (userError) throw userError;
    const u = Array.isArray(users) ? users[0] : null;
    return {
      email: normalized,
      name: (u && u.name) || 'Portal Preview',
      companyId: (u && u.company_id) || process.env.DEFAULT_COMPANY_ID || null,
      locationId: (u && u.location_id) || process.env.DEFAULT_LOCATION_ID || null,
    };
  }

  return null;
}

async function sendPortalCodeEmail({ email, name, code }) {
  const mailers = createConfiguredMailers();
  if (!mailers.length) throw new Error('Customer portal email verification is not configured');

  let lastError = null;
  for (const mailer of mailers) {
    try {
      await mailer.sendMail({
        to: email,
        subject: 'Your NodeRoute customer portal verification code',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#102040">
            <div style="background:#050d2a;padding:24px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#3dba7f;margin:0;font-size:24px">NodeRoute Customer Portal</h1>
            </div>
            <div style="background:#f8faff;padding:32px;border:1px solid #dde3f5;border-top:none;border-radius:0 0 12px 12px">
              <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${name || 'there'},</p>
              <p style="font-size:15px;line-height:1.6;margin:0 0 20px">
                Use the verification code below to access your customer portal. The code expires in 10 minutes.
              </p>
              <div style="font-size:34px;font-weight:700;letter-spacing:0.3em;text-align:center;color:#050d2a;background:#e8f5ee;border:1px solid #b8e0c8;border-radius:12px;padding:18px 20px;margin:0 0 20px">
                ${code}
              </div>
              <p style="font-size:13px;line-height:1.6;color:#667085;margin:0">
                If you did not request this code, you can ignore this email.
              </p>
            </div>
          </div>
        `,
        text: `Your NodeRoute customer portal verification code is ${code}. It expires in 10 minutes.`,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Could not send portal verification email');
}

function authenticatePortalToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let payload;
  try {
    payload = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (payload.role !== 'customer') return res.status(403).json({ error: 'Forbidden' });
  req.customerEmail = payload.email;
  req.customerName = payload.name;
  req.portalContext = {
    companyId: payload.companyId || null,
    activeCompanyId: payload.companyId || null,
    activeLocationId: payload.locationId || null,
    accessibleLocationIds: payload.locationId ? [payload.locationId] : [],
    isGlobalOperator: false,
  };
  next();
}

async function portalInvoiceBalanceSummary(email, portalContext) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id,total,status')
    .ilike('customer_email', email)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const scopedInvoices = filterRowsByContext(data || [], portalContext);
  const openInvoices = scopedInvoices.filter(invoiceIsOpen);
  const openBalance = openInvoices.reduce((sum, invoice) => sum + (parseFloat(invoice.total) || 0), 0);
  return {
    invoiceCount: scopedInvoices.length,
    openInvoiceCount: openInvoices.length,
    openBalance: parseFloat(openBalance.toFixed(2)),
  };
}

function isMissingPortalPaymentTables(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('relation') && (
    message.includes('portal_payment_methods') ||
    message.includes('portal_payment_settings') ||
    message.includes('portal_payment_events')
  );
}

function paymentTablesUnavailableResponse(res) {
  return res.status(503).json({
    error: 'Portal payment tables are not installed yet. Run supabase-portal-payments-migration.sql first.',
    code: 'PORTAL_PAYMENT_TABLES_MISSING',
  });
}

function normalizePaymentMethodType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'debit' || normalized === 'debitcard' || normalized === 'debit_card') return 'debit_card';
  if (normalized === 'ach' || normalized === 'bank' || normalized === 'ach_bank') return 'ach_bank';
  return normalized;
}

function sanitizePaymentMethod(method) {
  return {
    id: method.id,
    method_type: method.method_type,
    provider: method.provider || PORTAL_PAYMENT_PROVIDER,
    payment_method_ref: method.payment_method_ref || null,
    label: method.label || null,
    is_default: !!method.is_default,
    status: method.status || 'active',
    brand: method.brand || null,
    last4: method.last4 || null,
    exp_month: method.exp_month || null,
    exp_year: method.exp_year || null,
    bank_name: method.bank_name || null,
    account_last4: method.account_last4 || null,
    routing_last4: method.routing_last4 || null,
    account_type: method.account_type || null,
    created_at: method.created_at || null,
    updated_at: method.updated_at || null,
  };
}

function defaultAutopaySettings() {
  return {
    enabled: false,
    autopay_day_of_month: 1,
    method_id: null,
    max_amount: null,
    last_run_at: null,
    next_run_at: null,
  };
}

async function loadPortalPaymentState(req) {
  const [{ data: methodsRaw, error: methodsError }, { data: settingsRaw, error: settingsError }] = await Promise.all([
    supabase
      .from('portal_payment_methods')
      .select('*')
      .eq('customer_email', req.customerEmail)
      .order('created_at', { ascending: false }),
    supabase
      .from('portal_payment_settings')
      .select('*')
      .eq('customer_email', req.customerEmail)
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);

  if (methodsError) throw methodsError;
  if (settingsError) throw settingsError;

  const methods = filterRowsByContext(methodsRaw || [], req.portalContext)
    .filter((method) => String(method.status || 'active').toLowerCase() !== 'archived')
    .map(sanitizePaymentMethod);
  const settingsRow = filterRowsByContext(settingsRaw || [], req.portalContext)[0] || null;
  return {
    methods,
    settings: settingsRow
      ? {
          enabled: !!settingsRow.autopay_enabled,
          autopay_day_of_month: settingsRow.autopay_day_of_month || 1,
          method_id: settingsRow.method_id || null,
          max_amount: settingsRow.max_amount || null,
          last_run_at: settingsRow.last_run_at || null,
          next_run_at: settingsRow.next_run_at || null,
        }
      : defaultAutopaySettings(),
  };
}

function isStripeProviderEnabled() {
  return PORTAL_PAYMENT_ENABLED && PORTAL_PAYMENT_PROVIDER === 'stripe' && !!STRIPE_PUBLISHABLE_KEY && isStripeConfigured();
}

function openInvoiceStatuses() {
  return new Set(['pending', 'signed', 'sent']);
}

function invoiceIsOpen(invoice) {
  return openInvoiceStatuses().has(String(invoice?.status || '').toLowerCase());
}

async function listScopedCustomerInvoices(email, portalContext) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .ilike('customer_email', email)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return filterRowsByContext(data || [], portalContext);
}

function toMoney(value) {
  return parseFloat((parseFloat(value || 0) || 0).toFixed(2));
}

async function recordPortalPaymentEvent(req, payload) {
  return insertRecordWithOptionalScope(
    supabase,
    'portal_payment_events',
    {
      ...buildScopeFields(req.portalContext),
      customer_email: req.customerEmail,
      event_type: payload.event_type,
      amount: toMoney(payload.amount),
      currency: payload.currency || PORTAL_PAYMENT_CURRENCY,
      method_id: payload.method_id || null,
      method_type: payload.method_type || null,
      provider: payload.provider || PORTAL_PAYMENT_PROVIDER,
      status: payload.status || 'queued',
      message: payload.message || null,
      created_at: new Date().toISOString(),
    },
    req.portalContext
  );
}

function stripePaymentMethodSummary(paymentMethod) {
  if (!paymentMethod) return null;
  if (paymentMethod.type === 'us_bank_account') {
    return {
      method_type: 'ach_bank',
      brand: null,
      last4: null,
      exp_month: null,
      exp_year: null,
      bank_name: paymentMethod.us_bank_account?.bank_name || null,
      account_last4: paymentMethod.us_bank_account?.last4 || null,
      routing_last4: paymentMethod.us_bank_account?.routing_number
        ? String(paymentMethod.us_bank_account.routing_number).slice(-4)
        : null,
      account_type: paymentMethod.us_bank_account?.account_type || null,
    };
  }
  return {
    method_type: 'debit_card',
    brand: paymentMethod.card?.brand || null,
    last4: paymentMethod.card?.last4 || null,
    exp_month: paymentMethod.card?.exp_month || null,
    exp_year: paymentMethod.card?.exp_year || null,
    bank_name: null,
    account_last4: null,
    routing_last4: null,
    account_type: null,
  };
}

// POST /api/portal/auth — send a short-lived verification code to the customer email
router.post('/auth', async (req, res) => {
  pruneExpiredChallenges();

  const normalized = normalizeEmail(req.body?.email);
  if (!normalized) return res.status(400).json({ error: 'Email required' });
  if (!canRequestCode(normalized)) {
    return res.status(429).json({ error: 'Too many portal login attempts. Please wait a few minutes and try again.' });
  }

  try {
    const customer = await resolvePortalCustomer(normalized);
    if (!customer) {
      touchRateLimitBucket(normalized);
      return res.status(404).json({ error: 'No account found for that email. Contact your NodeRoute representative.' });
    }

    const existing = [...portalChallenges.values()].find((challenge) => challenge.email === normalized);
    if (existing && Date.now() - existing.lastSentAt < PORTAL_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((PORTAL_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000);
      return res.status(429).json({
        error: 'A verification code was just sent. Please wait a moment before requesting another one.',
        retryAfterSeconds,
      });
    }

    const challengeId = crypto.randomBytes(24).toString('hex');
    const code = generateVerificationCode();
    const challenge = {
      id: challengeId,
      email: customer.email,
      name: customer.name,
      codeHash: hashCode(challengeId, code),
      expiresAt: Date.now() + PORTAL_CODE_TTL_MS,
      attemptsLeft: PORTAL_MAX_VERIFY_ATTEMPTS,
      lastSentAt: Date.now(),
    };

    if (existing) portalChallenges.delete(existing.id);
    await sendPortalCodeEmail({ email: customer.email, name: customer.name, code });
    portalChallenges.set(challengeId, challenge);
    touchRateLimitBucket(normalized);

    return res.json({
      challengeId,
      maskedEmail: customer.email.replace(/(^.).*(@.*$)/, '$1***$2'),
      name: customer.name,
      expiresInSeconds: Math.floor(PORTAL_CODE_TTL_MS / 1000),
    });
  } catch (error) {
    console.error('portal/auth:', error.message);
    return res.status(500).json({ error: error.message || 'Could not start customer portal sign-in' });
  }
});

router.post('/verify', async (req, res) => {
  pruneExpiredChallenges();

  const challengeId = String(req.body?.challengeId || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!challengeId || !code) return res.status(400).json({ error: 'Challenge ID and verification code are required' });

  const challenge = portalChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    if (challenge) portalChallenges.delete(challengeId);
    return res.status(401).json({ error: 'This verification code has expired. Please request a new one.' });
  }

  if (!codesMatch(challenge.codeHash, hashCode(challengeId, code))) {
    challenge.attemptsLeft -= 1;
    if (challenge.attemptsLeft <= 0) {
      portalChallenges.delete(challengeId);
      return res.status(401).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
    }
    return res.status(401).json({ error: `Incorrect code. ${challenge.attemptsLeft} attempt${challenge.attemptsLeft === 1 ? '' : 's'} remaining.` });
  }

  portalChallenges.delete(challengeId);
  return res.json({
    token: signPortalJWT(challenge.email, challenge.name, challenge),
    name: challenge.name,
    email: challenge.email,
  });
});

// GET /api/portal/me
router.get('/me', authenticatePortalToken, (req, res) => {
  res.json({ email: req.customerEmail, name: req.customerName });
});

// GET /api/portal/payments/config
router.get('/payments/config', authenticatePortalToken, async (req, res) => {
  try {
    const balance = await portalInvoiceBalanceSummary(req.customerEmail, req.portalContext);
    const paymentState = await loadPortalPaymentState(req);
    const providerEnabled =
      (isStripeProviderEnabled()) ||
      (PORTAL_PAYMENT_ENABLED && PORTAL_PAYMENT_PROVIDER === 'stub' && !!PORTAL_PAYMENT_STUB_CHECKOUT_URL);

    return res.json({
      enabled: providerEnabled,
      provider: PORTAL_PAYMENT_PROVIDER,
      publishable_key: PORTAL_PAYMENT_PROVIDER === 'stripe' ? STRIPE_PUBLISHABLE_KEY : null,
      currency: PORTAL_PAYMENT_CURRENCY,
      support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
      manual_payment_available: true,
      supported_method_types: AUTOPAY_METHOD_TYPES,
      supports_autopay: true,
      balance,
      payment_methods: paymentState.methods,
      autopay: paymentState.settings,
    });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not load payment configuration' });
  }
});

// GET /api/portal/payments/profile
router.get('/payments/profile', authenticatePortalToken, async (req, res) => {
  try {
    const [balance, paymentState] = await Promise.all([
      portalInvoiceBalanceSummary(req.customerEmail, req.portalContext),
      loadPortalPaymentState(req),
    ]);
    return res.json({
      customer_email: req.customerEmail,
      supported_method_types: AUTOPAY_METHOD_TYPES,
      payment_methods: paymentState.methods,
      autopay: paymentState.settings,
      balance,
    });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not load payment profile' });
  }
});

// POST /api/portal/payments/setup-intent
router.post('/payments/setup-intent', authenticatePortalToken, async (req, res) => {
  try {
    if (!isStripeProviderEnabled()) {
      return res.status(501).json({
        error: 'Stripe setup intents are not configured yet.',
        code: 'STRIPE_NOT_CONFIGURED',
      });
    }

    const methodType = normalizePaymentMethodType(req.body.method_type || 'debit_card');
    if (!AUTOPAY_METHOD_TYPES.includes(methodType)) {
      return res.status(400).json({ error: 'method_type must be debit_card or ach_bank' });
    }

    const customer = await findOrCreateCustomer({
      email: req.customerEmail,
      name: req.customerName,
      metadata: {
        portal_customer_email: req.customerEmail,
        company_id: req.portalContext.companyId || '',
        location_id: req.portalContext.activeLocationId || '',
      },
    });
    const setupIntent = await createSetupIntent({
      customerId: customer.id,
      methodType,
      metadata: {
        customer_email: req.customerEmail,
        company_id: req.portalContext.companyId || '',
        location_id: req.portalContext.activeLocationId || '',
      },
    });

    return res.json({
      provider: 'stripe',
      publishable_key: STRIPE_PUBLISHABLE_KEY,
      customer_id: customer.id,
      setup_intent_id: setupIntent.id,
      client_secret: setupIntent.client_secret,
      method_type: methodType,
    });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not create setup intent' });
  }
});

// POST /api/portal/payments/methods
router.post('/payments/methods', authenticatePortalToken, async (req, res) => {
  try {
    const requestedMethodType = normalizePaymentMethodType(req.body.method_type);
    let methodType = requestedMethodType;
    if (!AUTOPAY_METHOD_TYPES.includes(methodType)) {
      return res.status(400).json({ error: 'method_type must be debit_card or ach_bank' });
    }

    const paymentMethodRef = String(req.body.payment_method_ref || '').trim();
    if (!paymentMethodRef) return res.status(400).json({ error: 'payment_method_ref is required' });

    const existingState = await loadPortalPaymentState(req);
    const nowIso = new Date().toISOString();
    const isDefault = req.body.is_default === true || req.body.is_default === 'true' || !existingState.methods.length;
    const provider = String(req.body.provider || PORTAL_PAYMENT_PROVIDER || 'manual').toLowerCase();
    let stripeSummary = null;

    if (provider === 'stripe') {
      if (!isStripeProviderEnabled()) {
        return res.status(501).json({ error: 'Stripe is not configured on this environment' });
      }
      const customer = await findOrCreateCustomer({
        email: req.customerEmail,
        name: req.customerName,
        metadata: {
          portal_customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });
      await attachPaymentMethod({ paymentMethodId: paymentMethodRef, customerId: customer.id });
      const stripeMethod = await retrievePaymentMethod(paymentMethodRef);
      stripeSummary = stripePaymentMethodSummary(stripeMethod);
      const normalizedStripeType = portalMethodTypeForStripeType(stripeMethod.type);
      if (requestedMethodType && requestedMethodType !== normalizedStripeType) {
        return res.status(400).json({ error: 'Selected method type does not match Stripe payment method type' });
      }
      methodType = normalizedStripeType;
    } else {
      if (methodType === 'debit_card') {
        const last4 = String(req.body.last4 || '').trim();
        const expMonth = Number(req.body.exp_month);
        const expYear = Number(req.body.exp_year);
        if (!/^\d{4}$/.test(last4)) return res.status(400).json({ error: 'Debit card last4 must be 4 digits' });
        if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) return res.status(400).json({ error: 'exp_month must be 1-12' });
        if (!Number.isInteger(expYear) || expYear < new Date().getFullYear()) return res.status(400).json({ error: 'exp_year is invalid' });
      }
      if (methodType === 'ach_bank') {
        const accountLast4 = String(req.body.account_last4 || '').trim();
        if (!/^\d{4}$/.test(accountLast4)) return res.status(400).json({ error: 'ACH account_last4 must be 4 digits' });
      }
    }

    const insertPayload = {
      ...buildScopeFields(req.portalContext),
      customer_email: req.customerEmail,
      method_type: methodType,
      provider,
      label: String(req.body.label || '').trim() || null,
      payment_method_ref: paymentMethodRef,
      is_default: isDefault,
      status: 'active',
      brand: methodType === 'debit_card' ? (stripeSummary?.brand ?? (String(req.body.brand || '').trim() || null)) : null,
      last4: methodType === 'debit_card' ? (stripeSummary?.last4 ?? String(req.body.last4 || '').trim()) : null,
      exp_month: methodType === 'debit_card' ? (stripeSummary?.exp_month ?? Number(req.body.exp_month)) : null,
      exp_year: methodType === 'debit_card' ? (stripeSummary?.exp_year ?? Number(req.body.exp_year)) : null,
      bank_name: methodType === 'ach_bank' ? (stripeSummary?.bank_name ?? (String(req.body.bank_name || '').trim() || null)) : null,
      account_last4: methodType === 'ach_bank' ? (stripeSummary?.account_last4 ?? String(req.body.account_last4 || '').trim()) : null,
      routing_last4: methodType === 'ach_bank' ? (stripeSummary?.routing_last4 ?? (String(req.body.routing_last4 || '').trim() || null)) : null,
      account_type: methodType === 'ach_bank'
        ? (stripeSummary?.account_type ?? (String(req.body.account_type || '').trim().toLowerCase() || null))
        : null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const insertResult = await insertRecordWithOptionalScope(supabase, 'portal_payment_methods', insertPayload, req.portalContext);
    if (insertResult.error) throw insertResult.error;

    if (isDefault) {
      for (const existingMethod of existingState.methods) {
        if (existingMethod.id === insertResult.data.id) continue;
        await supabase
          .from('portal_payment_methods')
          .update({ is_default: false, updated_at: nowIso })
          .eq('id', existingMethod.id);
      }
    }

    return res.json({
      message: 'Payment method saved',
      method: sanitizePaymentMethod(insertResult.data),
    });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not save payment method' });
  }
});

// DELETE /api/portal/payments/methods/:id
router.delete('/payments/methods/:id', authenticatePortalToken, async (req, res) => {
  try {
    const methodId = String(req.params.id || '').trim();
    if (!methodId) return res.status(400).json({ error: 'Payment method id is required' });

    const paymentState = await loadPortalPaymentState(req);
    const target = paymentState.methods.find((method) => method.id === methodId);
    if (!target) return res.status(404).json({ error: 'Payment method not found' });

    if (String(target.provider || '').toLowerCase() === 'stripe' && target.payment_method_ref) {
      try {
        await detachPaymentMethod(target.payment_method_ref);
      } catch (error) {
        // Continue archival in NodeRoute even if Stripe already detached / unavailable.
      }
    }

    const archiveResult = await executeWithOptionalScope(
      (candidate) => supabase.from('portal_payment_methods').update(candidate).eq('id', methodId).select('*').single(),
      { status: 'archived', is_default: false, updated_at: new Date().toISOString() }
    );
    if (archiveResult.error) throw archiveResult.error;

    if (target.is_default) {
      const remaining = paymentState.methods.filter((method) => method.id !== methodId);
      if (remaining[0]) {
        await supabase
          .from('portal_payment_methods')
          .update({ is_default: true, updated_at: new Date().toISOString() })
          .eq('id', remaining[0].id);
      }
    }

    return res.json({ message: 'Payment method removed' });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not remove payment method' });
  }
});

// PATCH /api/portal/payments/autopay
router.patch('/payments/autopay', authenticatePortalToken, async (req, res) => {
  try {
    const paymentState = await loadPortalPaymentState(req);
    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    const methodId = String(req.body.method_id || '').trim() || null;
    const dayOfMonth = Math.max(1, Math.min(28, Number(req.body.autopay_day_of_month || 1)));
    const maxAmount = req.body.max_amount == null || req.body.max_amount === ''
      ? null
      : parseFloat(req.body.max_amount);

    if (enabled) {
      if (!methodId) return res.status(400).json({ error: 'method_id is required when enabling autopay' });
      const methodExists = paymentState.methods.some((method) => method.id === methodId);
      if (!methodExists) return res.status(400).json({ error: 'Selected payment method is not available' });
    }

    const nextRun = enabled
      ? (() => {
          const now = new Date();
          const next = new Date(now);
          next.setUTCDate(1);
          next.setUTCHours(12, 0, 0, 0);
          next.setUTCDate(dayOfMonth);
          if (next.getTime() <= now.getTime()) next.setUTCMonth(next.getUTCMonth() + 1);
          return next.toISOString();
        })()
      : null;

    const nowIso = new Date().toISOString();
    const payload = {
      ...buildScopeFields(req.portalContext),
      customer_email: req.customerEmail,
      autopay_enabled: enabled,
      method_id: enabled ? methodId : null,
      autopay_day_of_month: enabled ? dayOfMonth : 1,
      max_amount: Number.isFinite(maxAmount) ? maxAmount : null,
      next_run_at: nextRun,
      updated_at: nowIso,
    };

    const { data: existingRows, error: existingErr } = await supabase
      .from('portal_payment_settings')
      .select('*')
      .eq('customer_email', req.customerEmail)
      .order('updated_at', { ascending: false })
      .limit(10);
    if (existingErr) throw existingErr;
    const existing = filterRowsByContext(existingRows || [], req.portalContext)[0] || null;

    const writeResult = existing?.id
      ? await executeWithOptionalScope(
          (candidate) => supabase.from('portal_payment_settings').update(candidate).eq('id', existing.id).select('*').single(),
          payload
        )
      : await insertRecordWithOptionalScope(supabase, 'portal_payment_settings', payload, req.portalContext);

    if (writeResult.error) throw writeResult.error;
    return res.json({
      message: 'Autopay settings updated',
      autopay: {
        enabled: !!writeResult.data.autopay_enabled,
        method_id: writeResult.data.method_id || null,
        autopay_day_of_month: writeResult.data.autopay_day_of_month || 1,
        max_amount: writeResult.data.max_amount || null,
        next_run_at: writeResult.data.next_run_at || null,
        last_run_at: writeResult.data.last_run_at || null,
      },
    });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not update autopay settings' });
  }
});

// POST /api/portal/payments/autopay/charge-now
router.post('/payments/autopay/charge-now', authenticatePortalToken, async (req, res) => {
  try {
    if (!isStripeProviderEnabled()) {
      return res.status(501).json({ error: 'Stripe autopay is not configured', code: 'STRIPE_NOT_CONFIGURED' });
    }

    const [invoices, paymentState] = await Promise.all([
      listScopedCustomerInvoices(req.customerEmail, req.portalContext),
      loadPortalPaymentState(req),
    ]);
    const openInvoices = invoices.filter(invoiceIsOpen);
    const openBalance = toMoney(openInvoices.reduce((sum, invoice) => sum + toMoney(invoice.total), 0));

    if (!paymentState.settings.enabled && req.body?.force !== true) {
      return res.status(400).json({ error: 'Autopay is not enabled', code: 'AUTOPAY_DISABLED' });
    }
    if (openBalance <= 0) {
      return res.status(400).json({ error: 'No open balance to pay', code: 'NO_OPEN_BALANCE' });
    }

    const method = paymentState.methods.find((m) => m.id === paymentState.settings.method_id) || null;
    if (!method) return res.status(400).json({ error: 'Autopay method is missing', code: 'AUTOPAY_METHOD_MISSING' });
    if (String(method.provider || '').toLowerCase() !== 'stripe') {
      return res.status(400).json({ error: 'Autopay method must be a Stripe payment method', code: 'AUTOPAY_METHOD_INVALID' });
    }

    const customer = await findOrCreateCustomer({
      email: req.customerEmail,
      name: req.customerName,
      metadata: {
        portal_customer_email: req.customerEmail,
        company_id: req.portalContext.companyId || '',
        location_id: req.portalContext.activeLocationId || '',
      },
    });

    const maxAmount = Number.isFinite(parseFloat(paymentState.settings.max_amount))
      ? toMoney(paymentState.settings.max_amount)
      : null;
    let runningTotal = 0;
    const processed = [];
    const failures = [];

    for (const invoice of openInvoices) {
      const amount = toMoney(invoice.total);
      if (maxAmount != null && runningTotal + amount > maxAmount) break;
      try {
        const intent = await createPaymentIntent({
          amount,
          currency: PORTAL_PAYMENT_CURRENCY,
          customerId: customer.id,
          paymentMethodId: method.payment_method_ref,
          description: `NodeRoute invoice ${invoice.invoice_number || invoice.id}`,
          metadata: {
            source: 'autopay_charge_now',
            customer_email: req.customerEmail,
            invoice_id: invoice.id,
            company_id: req.portalContext.companyId || '',
            location_id: req.portalContext.activeLocationId || '',
          },
          idempotencyKey: `portal-autopay-${invoice.id}-${Date.now()}`,
        });

        const status = String(intent.status || 'queued');
        await recordPortalPaymentEvent(req, {
          event_type: 'autopay_charge_now',
          amount,
          method_id: method.id,
          method_type: method.method_type,
          provider: 'stripe',
          status,
          message: `Stripe payment intent ${intent.id}`,
        });

        if (status === 'succeeded') {
          await supabase.from('invoices').update({ status: 'paid', sent_at: new Date().toISOString() }).eq('id', invoice.id);
        }

        runningTotal += amount;
        processed.push({
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number || null,
          amount,
          intent_id: intent.id,
          status,
        });
      } catch (error) {
        failures.push({
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number || null,
          amount,
          error: error.message,
        });
        await recordPortalPaymentEvent(req, {
          event_type: 'autopay_charge_now',
          amount,
          method_id: method.id,
          method_type: method.method_type,
          provider: 'stripe',
          status: 'failed',
          message: error.message,
        });
      }
    }

    await supabase
      .from('portal_payment_settings')
      .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('customer_email', req.customerEmail);

    return res.json({
      message: processed.length
        ? `Processed ${processed.length} invoice payment${processed.length === 1 ? '' : 's'} via autopay.`
        : 'No invoice payments were processed.',
      attempted_open_balance: openBalance,
      charged_amount: toMoney(runningTotal),
      processed,
      failures,
    });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not trigger autopay charge' });
  }
});

// POST /api/portal/payments/create-checkout-session
router.post('/payments/create-checkout-session', authenticatePortalToken, async (req, res) => {
  try {
    const balance = await portalInvoiceBalanceSummary(req.customerEmail, req.portalContext);
    if (balance.openBalance <= 0) {
      return res.status(400).json({ error: 'No open balance to pay', code: 'NO_OPEN_BALANCE' });
    }

    if (!PORTAL_PAYMENT_ENABLED) {
      return res.status(501).json({
        error: 'Online payments are not configured yet. Please use manual payment instructions.',
        code: 'PAYMENT_NOT_CONFIGURED',
        support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
      });
    }

    if (isStripeProviderEnabled()) {
      const customer = await findOrCreateCustomer({
        email: req.customerEmail,
        name: req.customerName,
        metadata: {
          portal_customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });
      const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
      const session = await createCheckoutSession({
        customerId: customer.id,
        amount: balance.openBalance,
        currency: PORTAL_PAYMENT_CURRENCY,
        successUrl: `${baseUrl}/portal?payment=success`,
        cancelUrl: `${baseUrl}/portal?payment=cancelled`,
        metadata: {
          source: 'portal_checkout',
          customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });

      await recordPortalPaymentEvent(req, {
        event_type: 'checkout_session_created',
        amount: balance.openBalance,
        provider: 'stripe',
        status: 'queued',
        message: `Stripe checkout session ${session.id}`,
      });

      return res.json({
        checkout_url: session.url,
        provider: 'stripe',
        amount_due: balance.openBalance,
        session_id: session.id,
      });
    }

    if (PORTAL_PAYMENT_PROVIDER === 'stub' && PORTAL_PAYMENT_STUB_CHECKOUT_URL) {
      const ref = `portal_${Date.now()}`;
      return res.json({
        checkout_url: `${PORTAL_PAYMENT_STUB_CHECKOUT_URL}${PORTAL_PAYMENT_STUB_CHECKOUT_URL.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`,
        provider: 'stub',
        amount_due: balance.openBalance,
      });
    }

    return res.status(501).json({
      error: 'Checkout provider not wired yet. Configure your payment provider server-side.',
      code: 'PAYMENT_PROVIDER_NOT_READY',
      support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not start checkout session' });
  }
});

// POST /api/portal/invoices/:id/pay
router.post('/invoices/:id/pay', authenticatePortalToken, async (req, res) => {
  try {
    if (!isStripeProviderEnabled()) {
      return res.status(501).json({ error: 'Stripe payments are not configured', code: 'STRIPE_NOT_CONFIGURED' });
    }

    const invoiceId = String(req.params.id || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Invoice id is required' });

    const { data: invoiceRow, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .ilike('customer_email', req.customerEmail)
      .single();
    if (invoiceError || !invoiceRow) return res.status(404).json({ error: 'Invoice not found' });
    if (!filterRowsByContext([invoiceRow], req.portalContext).length) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoiceIsOpen(invoiceRow)) return res.status(400).json({ error: 'Invoice is not open for payment' });

    const amount = toMoney(invoiceRow.total);
    if (amount <= 0) return res.status(400).json({ error: 'Invoice amount must be greater than zero' });

    const paymentState = await loadPortalPaymentState(req);
    const requestedMethodId = String(req.body?.method_id || '').trim();
    const method = paymentState.methods.find((candidate) =>
      candidate.id === (requestedMethodId || paymentState.settings.method_id || '')
      || (!!candidate.is_default && !requestedMethodId && !paymentState.settings.method_id)
    );
    if (!method) {
      return res.status(400).json({ error: 'No default payment method available. Add a payment method first.' });
    }
    if (String(method.provider || '').toLowerCase() !== 'stripe') {
      return res.status(400).json({ error: 'Only Stripe payment methods are supported for this action.' });
    }

    const customer = await findOrCreateCustomer({
      email: req.customerEmail,
      name: req.customerName,
      metadata: {
        portal_customer_email: req.customerEmail,
        company_id: req.portalContext.companyId || '',
        location_id: req.portalContext.activeLocationId || '',
      },
    });

    const intent = await createPaymentIntent({
      amount,
      currency: PORTAL_PAYMENT_CURRENCY,
      customerId: customer.id,
      paymentMethodId: method.payment_method_ref,
      description: `NodeRoute invoice ${invoiceRow.invoice_number || invoiceRow.id}`,
      metadata: {
        source: 'portal_invoice_pay',
        customer_email: req.customerEmail,
        invoice_id: invoiceRow.id,
        company_id: req.portalContext.companyId || '',
        location_id: req.portalContext.activeLocationId || '',
      },
      idempotencyKey: `portal-invoice-pay-${invoiceRow.id}-${Date.now()}`,
    });

    const paymentStatus = String(intent.status || 'queued');
    await recordPortalPaymentEvent(req, {
      event_type: 'invoice_pay',
      amount,
      method_id: method.id,
      method_type: method.method_type,
      provider: 'stripe',
      status: paymentStatus,
      message: `Stripe payment intent ${intent.id}`,
    });

    if (paymentStatus === 'succeeded') {
      await supabase.from('invoices').update({ status: 'paid', sent_at: new Date().toISOString() }).eq('id', invoiceRow.id);
    }

    return res.json({
      message: paymentStatus === 'succeeded'
        ? 'Invoice paid successfully.'
        : `Payment is ${paymentStatus}. We will update the invoice once final settlement is confirmed.`,
      invoice_id: invoiceRow.id,
      payment_intent_id: intent.id,
      status: paymentStatus,
    });
  } catch (error) {
    if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
    return res.status(500).json({ error: error.message || 'Could not charge invoice' });
  }
});

// GET /api/portal/orders
router.get('/orders', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const scopedOrders = filterRowsByContext(data || [], req.portalContext);
  res.json(scopedOrders.map((order) => ({
    id: order.id,
    order_number: order.order_number,
    customer_name: order.customer_name,
    customer_address: order.customer_address,
    items: order.items,
    status: order.status,
    notes: order.notes,
    created_at: order.created_at,
    driver_name: order.driver_name,
  })));
});

// GET /api/portal/invoices
router.get('/invoices', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const scopedInvoices = filterRowsByContext(data || [], req.portalContext);
  res.json(scopedInvoices.map((invoice) => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    customer_name: invoice.customer_name,
    customer_address: invoice.customer_address,
    items: invoice.items,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    status: invoice.status,
    driver_name: invoice.driver_name,
    created_at: invoice.created_at,
    signed_at: invoice.signed_at,
    sent_at: invoice.sent_at,
  })));
});

// GET /api/portal/invoices/:id/pdf — scoped to the authenticated customer's email
router.get('/invoices/:id/pdf', authenticatePortalToken, async (req, res) => {
  const { data: inv, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', req.params.id)
    .ilike('customer_email', req.customerEmail)
    .single();
  if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!filterRowsByContext([inv], req.portalContext).length) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  const pdfBuffer = await buildInvoicePDF(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_number || inv.id.slice(0, 8)}.pdf"`);
  res.send(pdfBuffer);
});

// GET /api/portal/contact — return contact info from portal_contacts or most recent invoice
router.get('/contact', authenticatePortalToken, async (req, res) => {
  const { data: saved, error: savedError } = await supabase
    .from('portal_contacts')
    .select('*')
    .eq('email', req.customerEmail)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (savedError) return res.status(500).json({ error: savedError.message });

  const savedContact = filterRowsByContext(saved || [], req.portalContext)[0];

  if (savedContact) {
    return res.json({
      email: savedContact.email,
      name: savedContact.name,
      phone: savedContact.phone,
      address: savedContact.address,
      company: savedContact.company,
      door_code: savedContact.door_code,
      updated_at: savedContact.updated_at,
    });
  }

  // Fall back to most recent invoice data
  const { data: inv } = await supabase
    .from('invoices')
    .select('*')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false })
    .limit(10);

  const scopedInvoices = filterRowsByContext(inv || [], req.portalContext);
  const latestInvoice = scopedInvoices[0] || null;

  res.json({
    email: req.customerEmail,
    name: latestInvoice ? latestInvoice.customer_name : req.customerName,
    address: latestInvoice ? latestInvoice.customer_address : null,
    phone: null,
    company: null,
  });
});

// PATCH /api/portal/contact — upsert contact info into portal_contacts
router.patch('/contact', authenticatePortalToken, async (req, res) => {
  const { name, phone, address, company } = req.body;
  const { data: existingRows, error: existingError } = await supabase
    .from('portal_contacts')
    .select('*')
    .eq('email', req.customerEmail)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (existingError) return res.status(500).json({ error: existingError.message });

  const payload = {
    ...buildScopeFields(req.portalContext),
    email: req.customerEmail,
    name: name || req.customerName,
    phone: phone || null,
    address: address || null,
    company: company || null,
    updated_at: new Date().toISOString(),
  };
  const scopedExisting = filterRowsByContext(existingRows || [], req.portalContext);

  const result = scopedExisting[0]?.id
    ? await executeWithOptionalScope(
        (candidate) => supabase.from('portal_contacts').update(candidate).eq('id', scopedExisting[0].id).select('*').single(),
        payload
      )
    : await insertRecordWithOptionalScope(supabase, 'portal_contacts', payload, req.portalContext);

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json({ message: 'Contact information saved' });
});

// PATCH /api/portal/doorcode — customer saves their door/access code
router.patch('/doorcode', authenticatePortalToken, async (req, res) => {
  const { door_code } = req.body;
  const code = (door_code || '').trim() || null;

  // Update portal_contacts — preserve existing fields
  const { data: existingRows, error: existingError } = await supabase
    .from('portal_contacts')
    .select('*')
    .eq('email', req.customerEmail)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (existingError) return res.status(500).json({ error: existingError.message });

  const existing = filterRowsByContext(existingRows || [], req.portalContext)[0] || null;

  let contactWrite;
  if (existing) {
    contactWrite = await executeWithOptionalScope(
      (candidate) => supabase.from('portal_contacts').update(candidate).eq('id', existing.id).select('*').single(),
      {
        ...buildScopeFields(req.portalContext),
        door_code: code,
        updated_at: new Date().toISOString(),
      }
    );
  } else {
    contactWrite = await insertRecordWithOptionalScope(
      supabase,
      'portal_contacts',
      {
        email: req.customerEmail,
        name: req.customerName,
        door_code: code,
        updated_at: new Date().toISOString(),
      },
      req.portalContext
    );
  }
  if (contactWrite.error) return res.status(500).json({ error: contactWrite.error.message });

  // Best-effort: sync to matching stop row by name
  const lookupName = (existing && existing.name) || req.customerName;
  if (lookupName) {
    const { data: candidateStops } = await supabase
      .from('stops')
      .select('*')
      .ilike('name', lookupName);
    const scopedStops = filterRowsByContext(candidateStops || [], req.portalContext);
    for (const stop of scopedStops) {
      await supabase
      .from('stops')
      .update({ door_code: code })
      .eq('id', stop.id);
    }
  }

  res.json({ message: 'Door code saved' });
});

// GET /api/portal/inventory — in-stock seafood items, newest first
router.get('/inventory', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('seafood_inventory')
    .select('description, category, unit, on_hand_qty, on_hand_weight, cost, updated_at, created_at')
    .gt('on_hand_qty', 0)
    .order('updated_at', { ascending: false, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
