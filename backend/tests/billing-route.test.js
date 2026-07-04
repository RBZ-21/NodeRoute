const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

function installStripeStub({ checkoutUrl = 'https://checkout.stripe.test/session-1', sessionId = 'cs_test_1' } = {}) {
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
      findOrCreateCustomer: async ({ email }) => ({ id: `cus_${email}` }),
      createSubscriptionCheckoutSession: async () => ({ url: checkoutUrl, id: sessionId, livemode: false }),
    },
  };
}

function installAuthStub(user = null) {
  const authPath = require.resolve('../middleware/auth');
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      authenticateToken(req, _res, next) {
        if (user) {
          req.user = user;
          req.context = { activeCompanyId: user.company_id, isGlobalOperator: false };
        }
        next();
      },
      requireRole(...roles) {
        return (req, _res, next) => {
          if (!req.user) return _res.status(401).json({ error: 'Unauthorized' });
          if (!roles.includes(req.user.role) && req.user.role !== 'superadmin') {
            return _res.status(403).json({ error: 'Forbidden' });
          }
          next();
        };
      },
      requireSuperadmin(req, _res, next) {
        if (!req.user || req.user.role !== 'superadmin') {
          return _res.status(403).json({ error: 'Forbidden' });
        }
        next();
      },
      extractToken() {
        return null;
      },
    },
  };
}

function installSupabaseStub() {
  const supabasePath = require.resolve('../services/supabase');
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      supabase: {
        from() {
          return {
            select() {
              return {
                eq() {
                  return {
                    single: () => Promise.resolve({ data: null, error: null }),
                  };
                },
              };
            },
          };
        },
      },
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
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    NODEROUTE_STRIPE_PRICE_ID: process.env.NODEROUTE_STRIPE_PRICE_ID,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
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
    installStripeStub({ checkoutUrl: '', sessionId: '' });
  }

  const user = {
    id: 'billing-admin',
    name: 'Billing Admin',
    email: 'billing.admin@noderoute.test',
    role: 'admin',
    status: 'active',
    company_id: 'company-billing',
    location_id: 'loc-billing',
    accessible_company_ids: ['company-billing'],
    accessible_location_ids: ['loc-billing'],
  };
  installAuthStub(user);
  installSupabaseStub();

  let server;
  try {
    const { authenticateToken } = require('../middleware/auth');
    const app = express();
    app.use(express.json());
    app.use(authenticateToken);
    app.use('/api/billing', require('../routes/billing'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await run({ baseUrl });
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

test('GET /api/billing/config reports test-mode readiness for a configured company', async () => {
  await withBillingHarness(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/billing/config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.enabled, true);
    assert.equal(body.mode, 'test');
    assert.equal(body.company.id, 'company-billing');
  });
});

test('POST /api/billing/create-checkout-session returns a Stripe test-mode checkout URL', async () => {
  await withBillingHarness(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.checkout_url, 'https://checkout.stripe.test/session-1');
    assert.equal(body.test_mode, true);
  });
});

test('POST /api/billing/create-checkout-session is blocked when Stripe is not configured', async () => {
  await withBillingHarness(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 501);
    const body = await response.json();
    assert.equal(body.code, 'STRIPE_TEST_KEYS_MISSING');
  }, { stripeConfigured: false });
});
