'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { supabase } = require('../services/supabase');
const logger = require('../services/logger');
const {
  createSubscriptionCheckoutSession,
  findOrCreateCustomer,
  isStripeConfigured,
  isStripeTestMode,
  stripeKeyMode,
  stripeSecretKeyMode,
} = require('../services/stripe');
const { requireRole } = require('../middleware/auth');
const { stripeLimiter } = require('../middleware/rateLimiter');
const { loadCompanyBilling } = require('../services/superadmin-billing');

const router = express.Router();

const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_ALLOW_LIVE_MODE = String(process.env.STRIPE_ALLOW_LIVE_MODE || 'false').toLowerCase() === 'true';
const NODEROUTE_STRIPE_PRICE_ID = process.env.NODEROUTE_STRIPE_PRICE_ID || process.env.STRIPE_NODEROUTE_PRICE_ID || '';
const NODEROUTE_BILLING_PRODUCT_NAME = process.env.NODEROUTE_BILLING_PRODUCT_NAME || 'NodeRoute Platform Subscription';
const NODEROUTE_BILLING_PRICE_LABEL = process.env.NODEROUTE_BILLING_PRICE_LABEL || 'Configured in Stripe';
const NODEROUTE_BILLING_SUPPORT_EMAIL =
  process.env.NODEROUTE_BILLING_SUPPORT_EMAIL ||
  process.env.PORTAL_PAYMENT_SUPPORT_EMAIL ||
  process.env.EMAIL_FROM ||
  'support@noderoute.com';

function companyId(req) {
  return req.context?.activeCompanyId || req.context?.companyId || req.user?.company_id || '';
}

function stripePublishableKeyMode() {
  return stripeKeyMode(STRIPE_PUBLISHABLE_KEY);
}

function stripeBillingMode() {
  const secretMode = stripeSecretKeyMode();
  const publishableMode = stripePublishableKeyMode();
  if (secretMode === 'live' || publishableMode === 'live') return 'live';
  if (secretMode === 'test' && publishableMode === 'test') return 'test';
  if (secretMode === 'missing' && publishableMode === 'missing') return 'missing';
  return 'unknown';
}

function liveModeAllowed() {
  return STRIPE_ALLOW_LIVE_MODE && stripeSecretKeyMode() === 'live' && stripePublishableKeyMode() === 'live';
}

function billingReadiness() {
  if (!isStripeConfigured() || !STRIPE_PUBLISHABLE_KEY) {
    return {
      ready: false,
      mode: stripeBillingMode(),
      code: 'STRIPE_TEST_KEYS_MISSING',
      message: 'NodeRoute billing preview requires Stripe test API keys. Set STRIPE_SECRET_KEY=sk_test_... and STRIPE_PUBLISHABLE_KEY=pk_test_...',
    };
  }

  const usingTestKeys = isStripeTestMode() && stripePublishableKeyMode() === 'test';
  if (!usingTestKeys && !liveModeAllowed()) {
    return {
      ready: false,
      mode: stripeBillingMode(),
      code: 'STRIPE_TEST_MODE_REQUIRED',
      message: 'NodeRoute billing preview is test mode only. Use sk_test_ and pk_test_ keys; live keys are blocked.',
    };
  }

  if (!NODEROUTE_STRIPE_PRICE_ID) {
    return {
      ready: false,
      mode: stripeBillingMode(),
      code: 'NODEROUTE_TEST_PRICE_MISSING',
      message: 'NodeRoute billing preview requires a Stripe test recurring Price ID in NODEROUTE_STRIPE_PRICE_ID.',
    };
  }

  if (!NODEROUTE_STRIPE_PRICE_ID.startsWith('price_')) {
    return {
      ready: false,
      mode: stripeBillingMode(),
      code: 'NODEROUTE_TEST_PRICE_INVALID',
      message: 'NODEROUTE_STRIPE_PRICE_ID must be a Stripe Price ID that starts with price_, not a dollar amount or product ID.',
    };
  }

  if (usingTestKeys) {
    return { ready: true, mode: 'test', code: 'STRIPE_TEST_MODE_READY', message: 'Stripe test mode billing preview is ready.' };
  }

  return { ready: true, mode: 'live', code: 'STRIPE_LIVE_MODE_READY', message: 'Stripe live billing is explicitly enabled.' };
}

function actionIdempotencySuffix(req) {
  const supplied = String(req.body?.idempotency_key || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(supplied) ? supplied : randomUUID();
}

async function loadBillingCompany(req) {
  const id = companyId(req);
  if (!id) return null;

  const { data, error } = await supabase
    .from('companies')
    .select('id,name,plan,status')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || {
    id,
    name: req.context?.companyName || req.user?.company_name || 'Your company',
    plan: null,
    status: null,
  };
}

function billingConfigPayload(req, company, billingProfile = null) {
  const readiness = billingReadiness();
  const canManageBilling = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  return {
    enabled: readiness.ready,
    provider: 'stripe',
    mode: readiness.mode,
    test_mode: readiness.mode === 'test',
    checkout_preview: readiness.mode === 'test' && readiness.ready,
    live_mode_blocked: readiness.mode === 'live' && !STRIPE_ALLOW_LIVE_MODE,
    readiness_code: readiness.code,
    message: readiness.message,
    can_manage_billing: canManageBilling,
    product_name: NODEROUTE_BILLING_PRODUCT_NAME,
    price_label: NODEROUTE_BILLING_PRICE_LABEL,
    support_email: NODEROUTE_BILLING_SUPPORT_EMAIL,
    company,
    billing_profile: billingProfile?.profile || null,
    effective_monthly_cents: billingProfile?.effectiveMonthlyCents ?? null,
    effective_setup_cents: billingProfile?.effectiveSetupCents ?? null,
    custom_pricing_enabled: billingProfile?.profile?.custom_pricing_enabled === true,
  };
}

router.get('/config', async (req, res) => {
  try {
    const company = await loadBillingCompany(req);
    if (!company) return res.status(400).json({ error: 'No company context.', code: 'NO_COMPANY_CONTEXT' });
    const billingProfile = company?.id ? await loadCompanyBilling(supabase, company.id).catch(() => null) : null;
    return res.json(billingConfigPayload(req, company, billingProfile));
  } catch (error) {
    const log = req.log || logger;
    log.error({ err: error, company_id: companyId(req) }, 'NodeRoute billing config failed');
    return res.status(500).json({ error: 'Could not load billing configuration', code: 'BILLING_CONFIG_FAILED' });
  }
});

// FIX [M8]: throttle subscription checkout session creation separately from general API traffic.
router.post('/create-checkout-session', stripeLimiter, requireRole('admin'), async (req, res) => {
  try {
    const company = await loadBillingCompany(req);
    if (!company) return res.status(400).json({ error: 'No company context.', code: 'NO_COMPANY_CONTEXT' });

    const readiness = billingReadiness();
    if (!readiness.ready) {
      return res.status(501).json({
        error: readiness.message,
        code: readiness.code,
        support_email: NODEROUTE_BILLING_SUPPORT_EMAIL,
        test_mode_only: true,
      });
    }

    const customer = await findOrCreateCustomer({
      email: req.user.email,
      name: company.name || req.user.name,
      metadata: {
        billing_customer: 'noderoute_distributor',
        company_id: company.id,
        company_name: company.name || '',
      },
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    const idempotencySuffix = actionIdempotencySuffix(req);
    const session = await createSubscriptionCheckoutSession({
      customerId: customer.id,
      priceId: NODEROUTE_STRIPE_PRICE_ID,
      successUrl: `${baseUrl}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/settings?billing=cancelled`,
      clientReferenceId: `noderoute:${company.id}`,
      idempotencyKey: `noderoute-billing-${company.id}-${idempotencySuffix}`,
      metadata: {
        source: 'noderoute_billing_checkout',
        checkout_type: 'noderoute_subscription',
        company_id: company.id,
        company_name: company.name || '',
        user_id: req.user.id,
      },
      subscriptionMetadata: {
        source: 'noderoute_billing_checkout',
        company_id: company.id,
        company_name: company.name || '',
      },
    });

    return res.json({
      checkout_url: session.url,
      provider: 'stripe',
      session_id: session.id,
      mode: session.livemode === true ? 'live' : 'test',
      test_mode: session.livemode !== true,
    });
  } catch (error) {
    const log = req.log || logger;
    log.error({ err: error, company_id: companyId(req), user_id: req.user?.id }, 'NodeRoute billing checkout failed');
    return res.status(500).json({
      error: 'Could not start NodeRoute billing checkout. Please try again or contact support.',
      code: 'BILLING_CHECKOUT_FAILED',
      support_email: NODEROUTE_BILLING_SUPPORT_EMAIL,
    });
  }
});

module.exports = router;
