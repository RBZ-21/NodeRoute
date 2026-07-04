const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}stripe.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}billing.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function installStripeStub({
  checkoutUrl = 'https://checkout.stripe.test/session-1',
  sessionId = 'cs_test_1',
  unreachable = false,
} = {}) {
  const stripePath = require.resolve('../services/stripe');
  const unreachableFn = async () => {
    throw new Error('should not be called');
  };
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      isStripeConfigured: () => true,
      isStripeTestMode: () => true,
      stripeKeyMode: (key) => (String(key || '').startsWith('pk_test_') ? 'test' : 'missing'),
      stripeSecretKeyMode: () => 'test',
      findOrCreateCustomer: unreachable ? unreachableFn : async ({ email }) => ({ id: `cus_${email}` }),
      createSubscriptionCheckoutSession: unreachable
        ? unreachableFn
        : async () => ({ url: checkoutUrl, id: sessionId, livemode: false }),
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function withBillingHarness(run, { stripeConfigured = true } = {}) {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-billing-route-'));
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    NODEROUTE_STRIPE_PRICE_ID: process.env.NODEROUTE_STRIPE_PRICE_ID,
  };
  // NODE_ENV=test neutralizes stripeLimiter (applied to create-checkout-session),
  // matching purchase-orders-draft-route.test.js / portal-payments-checkout-route.test.js.
  process.env.NODE_ENV = 'test';
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'billing-route-test-secret';
  if (stripeConfigured) {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_billing_route';
    process.env.NODEROUTE_STRIPE_PRICE_ID = 'price_billing_route_test';
  } else {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.NODEROUTE_STRIPE_PRICE_ID;
  }
  clearBackendModuleCache();

  if (stripeConfigured) {
    installStripeStub();
  } else {
    // billingReadiness() gates on the missing STRIPE_PUBLISHABLE_KEY/price-id env
    // vars deleted above, not on isStripeConfigured(). The customer/checkout
    // functions should never be reached in this scenario, so make them throw
    // to fail loudly if billing.js regresses and calls them before checking
    // readiness.
    installStripeStub({
      unreachable: true,
    });
  }

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const { authenticateToken } = require('../middleware/auth');

    const app = express();
    app.use(express.json());
    app.use('/api/billing', authenticateToken, require('../routes/billing'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await run({ baseUrl, supabase });
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function seedUser(supabase, overrides = {}) {
  return supabase.from('users').insert({
    id: 'billing-admin',
    name: 'Billing Admin',
    email: 'billing.admin@noderoute.test',
    role: 'admin',
    status: 'active',
    company_id: 'company-billing',
    location_id: 'loc-billing',
    accessible_company_ids: ['company-billing'],
    accessible_location_ids: ['loc-billing'],
    ...overrides,
  });
}

test('GET /api/billing/config reports test-mode readiness for a configured company', async () => {
  await withBillingHarness(async ({ baseUrl, supabase }) => {
    await seedUser(supabase);
    await supabase.from('companies').insert({
      id: 'company-billing',
      name: 'Billing Test Co',
      plan: 'pro',
      status: 'active',
    });
    const token = signToken('billing-admin');

    const response = await fetch(`${baseUrl}/api/billing/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.enabled, true);
    assert.equal(body.mode, 'test');
    // These values only come from the seeded `companies` row via a real,
    // tenant-scoped loadBillingCompany() lookup (supabase.from('companies')
    // .select(...).eq('id', activeCompanyId).single()) -- not from a stub.
    assert.equal(body.company.id, 'company-billing');
    assert.equal(body.company.name, 'Billing Test Co');
    assert.equal(body.company.plan, 'pro');
    assert.equal(body.company.status, 'active');
    assert.equal(body.can_manage_billing, true);
  });
});

test('GET /api/billing/config is scoped to the authenticated user\'s own company, not another tenant\'s', async () => {
  await withBillingHarness(async ({ baseUrl, supabase }) => {
    await seedUser(supabase);
    await supabase.from('companies').insert({
      id: 'company-billing',
      name: 'Billing Test Co',
      plan: 'pro',
      status: 'active',
    });
    // A different tenant's company row exists in the same demo-mode store.
    await supabase.from('companies').insert({
      id: 'company-other-tenant',
      name: 'Someone Else\'s Company',
      plan: 'enterprise',
      status: 'active',
    });
    const token = signToken('billing-admin');

    const response = await fetch(`${baseUrl}/api/billing/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    // Must resolve to the authenticated user's own company_id (from the real
    // JWT -> authenticateToken -> buildRequestContext flow), never the other
    // tenant's row, even though both exist in the same backing store.
    assert.equal(body.company.id, 'company-billing');
    assert.equal(body.company.name, 'Billing Test Co');
    assert.notEqual(body.company.id, 'company-other-tenant');
    assert.notEqual(body.company.name, 'Someone Else\'s Company');
  });
});

test('POST /api/billing/create-checkout-session returns a Stripe test-mode checkout URL', async () => {
  await withBillingHarness(async ({ baseUrl, supabase }) => {
    await seedUser(supabase);
    await supabase.from('companies').insert({
      id: 'company-billing',
      name: 'Billing Test Co',
      plan: 'pro',
      status: 'active',
    });
    const token = signToken('billing-admin');

    const response = await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.checkout_url, 'https://checkout.stripe.test/session-1');
    assert.equal(body.test_mode, true);
  });
});

test('POST /api/billing/create-checkout-session is blocked when Stripe is not configured', async () => {
  await withBillingHarness(async ({ baseUrl, supabase }) => {
    await seedUser(supabase);
    await supabase.from('companies').insert({
      id: 'company-billing',
      name: 'Billing Test Co',
      plan: 'pro',
      status: 'active',
    });
    const token = signToken('billing-admin');

    const response = await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 501);
    const body = await response.json();
    assert.equal(body.code, 'STRIPE_TEST_KEYS_MISSING');
  }, { stripeConfigured: false });
});

test('POST /api/billing/create-checkout-session rejects an unauthenticated request', async () => {
  await withBillingHarness(async ({ baseUrl, supabase }) => {
    await seedUser(supabase);
    await supabase.from('companies').insert({
      id: 'company-billing',
      name: 'Billing Test Co',
      plan: 'pro',
      status: 'active',
    });

    const response = await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 401);
  });
});
