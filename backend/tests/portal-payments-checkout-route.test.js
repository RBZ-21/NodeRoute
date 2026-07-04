const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

// payment-collection-routes.js's create-checkout-session handler does NOT take
// an invoice_id (or any body param) to select "which" invoice to pay. It derives
// the customer's open balance entirely from the authenticated portal token via
// portalInvoiceBalanceSummary(req.customerEmail, req.portalContext) in
// routes/portal/payments-shared.js, which:
//   1. filters invoices with .ilike('customer_email', email) (from the JWT), AND
//   2. scopes the query with scopeQueryByContext(...) + filterRowsByContext(...)
//      using req.portalContext (companyId/locationId, also from the JWT).
// So there is no cross-customer "invoice_id" to smuggle in the request body —
// the security-relevant question is instead: if customer A's portal token is
// used, and only customer B's invoice exists (under a different company),
// does checkout ever see/act on B's balance? It must not: A's open balance
// must compute to zero, so the endpoint responds 400 NO_OPEN_BALANCE instead
// of creating a Stripe checkout session against B's invoice.

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}stripe.js`) ||
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}portal${path.sep}`) ||
      // routes/portal-payments.js (the factory consumed below) is a SIBLING
      // file, not under routes/portal/, so it needs its own match — without
      // this, the second harness run reuses the first run's cached router,
      // which closed over the first run's demo-mode supabase/stripe modules.
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}portal-payments.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function installStripeStub() {
  const stripePath = require.resolve('../services/stripe');
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      isStripeConfigured: () => true,
      isStripeTestMode: () => true,
      stripeKeyMode: (key) => (String(key || '').startsWith('pk_test_') ? 'test' : 'missing'),
      stripeSecretKeyMode: () => 'test',
      portalMethodTypeForStripeType: () => 'debit_card',
      findOrCreateCustomer: async ({ email }) => ({ id: `cus_${email}` }),
      createCheckoutSession: async () => ({
        url: 'https://checkout.stripe.test/portal-session-1',
        id: 'cs_portal_1',
        livemode: false,
      }),
      createPaymentIntent: async () => ({ id: 'pi_portal_1', status: 'succeeded' }),
      createSetupIntent: async () => ({ id: 'seti_portal_1', client_secret: 'seti_secret' }),
      retrievePaymentMethod: async () => ({ id: 'pm_portal_1' }),
      attachPaymentMethod: async () => ({ id: 'pm_portal_1' }),
      detachPaymentMethod: async () => ({ id: 'pm_portal_1' }),
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

async function withHarness(run) {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-portal-payments-'));
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    PORTAL_JWT_SECRET: process.env.PORTAL_JWT_SECRET,
    PORTAL_PAYMENT_ENABLED: process.env.PORTAL_PAYMENT_ENABLED,
    PORTAL_PAYMENT_PROVIDER: process.env.PORTAL_PAYMENT_PROVIDER,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_ALLOW_LIVE_MODE: process.env.STRIPE_ALLOW_LIVE_MODE,
  };
  // NODE_ENV=test neutralizes stripeLimiter (applied to this route at
  // payment-collection-routes.js:206), matching billing-route.test.js /
  // purchase-orders-draft-route.test.js.
  process.env.NODE_ENV = 'test';
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.PORTAL_JWT_SECRET = 'portal-payments-route-test-secret';
  // Drive isStripeProviderEnabled() -> true so create-checkout-session takes
  // the Stripe branch instead of the 501 "not configured" / stub branches.
  process.env.PORTAL_PAYMENT_ENABLED = 'true';
  process.env.PORTAL_PAYMENT_PROVIDER = 'stripe';
  process.env.STRIPE_SECRET_KEY = 'sk_test_portal_payments_route';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_portal_payments_route';
  delete process.env.STRIPE_ALLOW_LIVE_MODE;
  clearBackendModuleCache();
  installStripeStub();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const { authenticatePortalToken } = require('../routes/portal/shared');
    const app = express();
    app.use(express.json());
    app.use('/', require('../routes/portal-payments')({ authenticatePortalToken }));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    await run({ supabase, baseUrl });
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

function signPortalToken({ email, name, companyId, locationId }) {
  return jwt.sign(
    { email, name, role: 'customer', companyId, locationId },
    'portal-payments-route-test-secret',
    { expiresIn: '1h' }
  );
}

test('POST /payments/create-checkout-session creates a Stripe session for the authenticated customer\'s own open balance', async () => {
  await withHarness(async ({ supabase, baseUrl }) => {
    await supabase.from('Customers').insert({
      id: 'portal-customer-a',
      company_name: 'Portal Customer A',
      email: 'portal.customer.a@noderoute.test',
      company_id: 'company-portal-a',
      location_id: 'loc-portal-a',
    });
    await supabase.from('invoices').insert({
      id: 'invoice-portal-a',
      customer_email: 'portal.customer.a@noderoute.test',
      status: 'sent',
      total: 150,
      items: [{ description: 'Line', quantity: 1, unit_price: 150, total: 150 }],
      company_id: 'company-portal-a',
      location_id: 'loc-portal-a',
    });

    const portalToken = signPortalToken({
      email: 'portal.customer.a@noderoute.test',
      name: 'Portal Customer A',
      companyId: 'company-portal-a',
      locationId: 'loc-portal-a',
    });

    const response = await fetch(`${baseUrl}/payments/create-checkout-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${portalToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const body = await response.json();
    assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
    assert.equal(body.checkout_url, 'https://checkout.stripe.test/portal-session-1');
    assert.equal(body.provider, 'stripe');
    assert.equal(body.amount_due, 150);
    assert.equal(body.session_id, 'cs_portal_1');
  });
});

test('POST /payments/create-checkout-session never checks out against another customer\'s invoice', async () => {
  await withHarness(async ({ supabase, baseUrl }) => {
    // Customer A (company-portal-a) has NO invoices of their own.
    await supabase.from('Customers').insert({
      id: 'portal-customer-a',
      company_name: 'Portal Customer A',
      email: 'portal.customer.a@noderoute.test',
      company_id: 'company-portal-a',
      location_id: 'loc-portal-a',
    });

    // Customer B (a different company/location) has an open invoice.
    await supabase.from('Customers').insert({
      id: 'portal-customer-b',
      company_name: 'Portal Customer B',
      email: 'portal.customer.b@noderoute.test',
      company_id: 'company-portal-b',
      location_id: 'loc-portal-b',
    });
    await supabase.from('invoices').insert({
      id: 'invoice-portal-b',
      customer_email: 'portal.customer.b@noderoute.test',
      status: 'sent',
      total: 999,
      items: [{ description: 'Line', quantity: 1, unit_price: 999, total: 999 }],
      company_id: 'company-portal-b',
      location_id: 'loc-portal-b',
    });

    // Authenticate as customer A. The handler has no request-body field for
    // selecting an invoice, so the only way A could reach B's invoice/balance
    // is if the server-side lookup failed to scope by both customer_email AND
    // company_id/location_id.
    const portalToken = signPortalToken({
      email: 'portal.customer.a@noderoute.test',
      name: 'Portal Customer A',
      companyId: 'company-portal-a',
      locationId: 'loc-portal-a',
    });

    const response = await fetch(`${baseUrl}/payments/create-checkout-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${portalToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const body = await response.json();
    // A must never get a Stripe checkout session (200) built against B's
    // $999 invoice. A has zero open balance of their own, so the endpoint
    // must fall into the NO_OPEN_BALANCE guard (payment-collection-routes.js:208-211).
    assert.notEqual(response.status, 200, `cross-customer checkout unexpectedly succeeded: ${JSON.stringify(body)}`);
    assert.equal(response.status, 400, `expected 400 NO_OPEN_BALANCE, got ${response.status}: ${JSON.stringify(body)}`);
    assert.equal(body.code, 'NO_OPEN_BALANCE');
    assert.notEqual(body.amount_due, 999);
    assert.notEqual(body.checkout_url, 'https://checkout.stripe.test/portal-session-1');

    // Confirm B's invoice was never touched/paid as a side effect either.
    const { data: [foreignInvoice] } = await supabase.from('invoices').select('*').eq('id', 'invoice-portal-b');
    assert.equal(foreignInvoice.status, 'sent');
    assert.equal(foreignInvoice.stripe_payment_intent_id, undefined);
  });
});
