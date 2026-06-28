const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const repoRoot = path.resolve(__dirname, '..', '..');
const supabasePath = require.resolve('../services/supabase');
const paymentsSharedPath = require.resolve('../routes/portal/payments-shared');
const paymentMethodRoutesPath = require.resolve('../routes/portal/payment-method-routes');

function readSources(paths) {
  return paths.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
}

function makeSupabase(tables, captures) {
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.singleRow = false;
      this.updating = null;
      this.inserting = null;
      this.sortField = null;
      this.sortAsc = true;
      this.limitN = null;
    }

    select() { return this; }
    order(field, opts = {}) {
      this.sortField = field;
      this.sortAsc = opts.ascending !== false;
      return this;
    }
    limit(n) { this.limitN = n; return this; }
    eq(field, value) {
      this.filters.push(['eq', field, value]);
      return this;
    }
    gte(field, value) {
      this.filters.push(['gte', field, value]);
      return this;
    }
    lte(field, value) {
      this.filters.push(['lte', field, value]);
      return this;
    }
    update(patch) {
      this.updating = patch;
      return this;
    }
    insert(records) {
      this.inserting = Array.isArray(records) ? records : [records];
      return this;
    }
    single() { this.singleRow = true; return this; }

    _applyFilters(rows) {
      let result = [...rows];
      for (const [op, field, value] of this.filters) {
        if (op === 'eq') {
          result = result.filter((row) => String(row[field] ?? '') === String(value ?? ''));
        } else if (op === 'gte') {
          result = result.filter((row) => String(row[field] ?? '') >= String(value ?? ''));
        } else if (op === 'lte') {
          result = result.filter((row) => String(row[field] ?? '') <= String(value ?? ''));
        }
      }
      if (this.sortField) {
        result.sort((a, b) => {
          const av = a[this.sortField];
          const bv = b[this.sortField];
          if (av === bv) return 0;
          return this.sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
      if (this.limitN != null) result = result.slice(0, this.limitN);
      return result;
    }

    then(resolve) {
      tables[this.table] = tables[this.table] || [];

      if (this.inserting) {
        const inserted = this.inserting.map((row, index) => ({
          id: row.id || `pm-${this.table}-${tables[this.table].length + index + 1}`,
          ...row,
        }));
        tables[this.table].push(...inserted);
        if (captures) {
          for (const row of inserted) captures.inserts.push({ table: this.table, row });
        }
        this.rows = inserted;
      } else if (this.updating) {
        const matched = this._applyFilters(tables[this.table]);
        for (const row of matched) {
          Object.assign(row, this.updating);
          if (captures) captures.updates.push({ table: this.table, id: row.id, patch: { ...this.updating } });
        }
        this.rows = matched;
      } else {
        this.rows = this._applyFilters(tables[this.table]);
      }

      const data = this.singleRow ? (this.rows[0] || null) : this.rows;
      const error = this.singleRow && !this.rows.length ? { message: 'no rows' } : null;
      return Promise.resolve({ data, error }).then(resolve);
    }
  }

  return { from: (table) => new Query(table) };
}

function loadPaymentMethodRouterWithSupabase(tables, captures) {
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { supabase: makeSupabase(tables, captures), dbQuery: async () => null },
  };
  delete require.cache[paymentsSharedPath];
  delete require.cache[paymentMethodRoutesPath];
  return require('../routes/portal/payment-method-routes');
}

function buildPaymentMethodApp(buildRouter, { companyId, email, name }) {
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, _res, next) => {
    req.customerEmail = email;
    req.customerName = name;
    req.portalContext = {
      companyId,
      activeCompanyId: companyId,
      activeLocationId: null,
      accessibleLocationIds: [],
      isGlobalOperator: false,
    };
    next();
  };
  app.use('/api/portal', buildRouter({ authenticatePortalToken: fakeAuth }));
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        { port, method, path, headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            server.close();
            let json = null;
            try { json = data ? JSON.parse(data) : null; } catch { /* non-json */ }
            resolve({ status: res.statusCode, body: json });
          });
        }
      );
      req.on('error', (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

const COMPANY_A = 'company-a';
const CUSTOMER_EMAIL = 'buyer@test.com';

function basePaymentTables() {
  return {
    portal_payment_methods: [
      {
        id: 'method-1',
        customer_email: CUSTOMER_EMAIL,
        company_id: COMPANY_A,
        location_id: null,
        method_type: 'debit_card',
        provider: 'manual',
        payment_method_ref: 'pm_ref_1',
        is_default: true,
        status: 'active',
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2028,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'method-2',
        customer_email: CUSTOMER_EMAIL,
        company_id: COMPANY_A,
        location_id: null,
        method_type: 'ach_bank',
        provider: 'manual',
        payment_method_ref: 'pm_ref_2',
        is_default: false,
        status: 'active',
        bank_name: 'Test Bank',
        account_last4: '9876',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ],
    portal_payment_settings: [
      {
        id: 'settings-1',
        customer_email: CUSTOMER_EMAIL,
        company_id: COMPANY_A,
        location_id: null,
        autopay_enabled: false,
        method_id: null,
        autopay_day_of_month: 1,
        max_amount: null,
        last_run_at: null,
        next_run_at: null,
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

const portalRouteSource = readSources([
  path.join(repoRoot, 'backend', 'routes', 'portal.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal-payments.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'shared.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payments-shared.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-profile-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-method-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-collection-routes.js'),
]);
const reactSrcDir = path.join(repoRoot, 'frontend-v2', 'src');
const portalFrontendSource = [
  path.join(reactSrcDir, 'hooks', 'usePortalData.ts'),
  path.join(reactSrcDir, 'pages', 'CustomerPortalPage.tsx'),
  path.join(reactSrcDir, 'pages', 'PortalTabViews.tsx'),
  path.join(reactSrcDir, 'pages', 'portal.types.ts'),
].map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('portal backend exposes payment readiness endpoints', () => {
  for (const marker of [
    "router.get('/payments/config'",
    "router.get('/payments/profile'",
    "router.post('/payments/methods'",
    "router.post('/payments/setup-intent'",
    "router.patch('/payments/autopay'",
    "router.post('/payments/autopay/charge-now'",
    "router.post('/payments/create-checkout-session'",
    "router.post('/invoices/:id/pay'",
    'PORTAL_PAYMENT_ENABLED',
    'isStripeProviderEnabled',
    'stripeCheckoutReadiness',
    'STRIPE_TEST_MODE_REQUIRED',
    'STRIPE_TEST_KEYS_MISSING',
    'portal-checkout-',
    'idempotencyKey',
    '{CHECKOUT_SESSION_ID}',
    'PAYMENT_NOT_CONFIGURED',
    'AUTOPAY_METHOD_TYPES',
  ]) {
    assert.ok(portalRouteSource.includes(marker), `missing portal payments marker ${marker}`);
  }
});

test('payment-method-routes imports scopeQueryByContext from operating-context', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-method-routes.js'),
    'utf8'
  );
  const importBlock = source.slice(0, source.indexOf('module.exports'));
  assert.match(importBlock, /\{ scopeQueryByContext \} = require\('\.\.\/\.\.\/services\/operating-context'\)/);
  assert.doesNotMatch(importBlock, /scopeQueryByContext,\s*\n\s*isMissingPortalPaymentTables/);
  const { scopeQueryByContext } = require('../services/operating-context');
  assert.equal(typeof scopeQueryByContext, 'function');
});

test('inventory-analysis scopes products, stock history, and lot queries by tenant', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ai.js'), 'utf8');
  const block = source.slice(source.indexOf("router.post('/inventory-analysis'"), source.indexOf('// ── PO IMAGE SCAN'));
  for (const table of ['products', 'inventory_stock_history', 'lot_codes']) {
    assert.match(block, new RegExp(`scopeQueryByContext\\([\\s\\S]*from\\('${table}'\\)`), `missing scoped query for ${table}`);
    assert.match(block, new RegExp(`from\\('${table}'\\)[\\s\\S]*company_id`), `missing company_id in ${table} select`);
    assert.match(block, new RegExp(`from\\('${table}'\\)[\\s\\S]*location_id`), `missing location_id in ${table} select`);
  }
});

// FIX [M1]: load portal payment state with scoped payment method and settings reads.
test('portal payment shared reads are scoped before customer filtering', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal', 'payments-shared.js'), 'utf8');
  const stateBlock = source.slice(source.indexOf('async function loadPortalPaymentState'), source.indexOf('function stripePublishableKeyMode'));
  const invoiceBlock = source.slice(source.indexOf('async function listScopedCustomerInvoices'), source.indexOf('function toMoney'));
  const balanceBlock = source.slice(source.indexOf('async function portalInvoiceBalanceSummary'), source.indexOf('async function ensureStripePortalCustomer'));

  assert.match(stateBlock, /scopeQueryByContext\(\s*supabase\s*\.\s*from\('portal_payment_methods'\)\s*\.select\('\*'\),\s*req\.portalContext,\s*\{\s*includeLocation:\s*true\s*\}/s);
  assert.match(stateBlock, /scopeQueryByContext\(\s*supabase\s*\.\s*from\('portal_payment_settings'\)\s*\.select\('\*'\),\s*req\.portalContext,\s*\{\s*includeLocation:\s*true\s*\}/s);
  assert.match(invoiceBlock, /scopeQueryByContext\(\s*supabase\s*\.\s*from\('invoices'\)\s*\.select\('\*'\),\s*portalContext,\s*\{\s*includeLocation:\s*true\s*\}/s);
  assert.match(balanceBlock, /scopeQueryByContext\(\s*supabase\s*\.\s*from\('invoices'\)\s*\.select\(/s);
});

// FIX [H1]: charge-now must scope portal_payment_settings updates.
test('portal payment collection writes and Stripe-triggering routes are scoped and throttled', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-collection-routes.js'), 'utf8');
  const chargeNowBlock = source.slice(source.indexOf("router.post('/payments/autopay/charge-now'"), source.indexOf("router.post('/payments/create-checkout-session'"));

  assert.match(chargeNowBlock, /stripeLimiter/);
  assert.match(chargeNowBlock, /scopeQueryByContext\(\s*supabase\s*\.\s*from\('portal_payment_settings'\)\s*\.update\(/s);
  assert.match(chargeNowBlock, /includeLocation:\s*true/);
  assert.match(source, /router\.post\('\/payments\/create-checkout-session',\s*authenticatePortalToken,\s*stripeLimiter/s);
  assert.match(source, /router\.post\('\/invoices\/:id\/pay',\s*authenticatePortalToken,\s*stripeLimiter/s);
});

// FIX [H5]: portal login must fail closed when an email maps to multiple tenant contexts.
test('portal auth refuses ambiguous customer email tenant resolution', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal', 'shared.js'), 'utf8');
  const resolveBlock = source.slice(source.indexOf('async function resolvePortalCustomer'), source.indexOf('async function sendPortalCodeEmail'));

  assert.match(source, /function portalTenantCandidates/);
  assert.match(source, /function uniquePortalTenantMatch/);
  assert.match(resolveBlock, /limit\(10\)/);
  assert.match(resolveBlock, /return null/);
});

// FIX [M6]: portal Stripe method/profile routes need narrow payment throttles.
test('portal Stripe setup and method mutation endpoints use stripeLimiter', () => {
  const methodSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-method-routes.js'), 'utf8');
  const profileSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-profile-routes.js'), 'utf8');

  assert.match(methodSource, /router\.post\('\/payments\/methods',\s*authenticatePortalToken,\s*stripeLimiter/s);
  assert.match(methodSource, /router\.delete\('\/payments\/methods\/:id',\s*authenticatePortalToken,\s*stripeLimiter/s);
  assert.match(profileSource, /router\.post\('\/payments\/setup-intent',\s*authenticatePortalToken,\s*stripeLimiter/s);
});

test('portal payment methods save creates a scoped manual debit card method', async () => {
  const tables = basePaymentTables();
  const captures = { inserts: [], updates: [] };
  const buildRouter = loadPaymentMethodRouterWithSupabase(tables, captures);
  const app = buildPaymentMethodApp(buildRouter, { companyId: COMPANY_A, email: CUSTOMER_EMAIL, name: 'Buyer' });

  const res = await request(app, 'POST', '/api/portal/payments/methods', {
    method_type: 'debit_card',
    payment_method_ref: 'pm_ref_new',
    brand: 'visa',
    last4: '1111',
    exp_month: 6,
    exp_year: 2029,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Payment method saved');
  assert.equal(res.body.method.method_type, 'debit_card');
  assert.equal(res.body.method.last4, '1111');

  const inserted = captures.inserts.find((entry) => entry.table === 'portal_payment_methods');
  assert.ok(inserted);
  assert.equal(inserted.row.company_id, COMPANY_A);
  assert.equal(inserted.row.customer_email, CUSTOMER_EMAIL);
});

test('portal payment methods delete archives the scoped method row', async () => {
  const tables = basePaymentTables();
  const captures = { inserts: [], updates: [] };
  const buildRouter = loadPaymentMethodRouterWithSupabase(tables, captures);
  const app = buildPaymentMethodApp(buildRouter, { companyId: COMPANY_A, email: CUSTOMER_EMAIL, name: 'Buyer' });

  const res = await request(app, 'DELETE', '/api/portal/payments/methods/method-2');

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Payment method removed');

  const archived = captures.updates.find((entry) => entry.table === 'portal_payment_methods' && entry.id === 'method-2');
  assert.ok(archived, 'expected scoped archive update');
  assert.equal(archived.patch.status, 'archived');
  assert.equal(archived.patch.is_default, false);

  const row = tables.portal_payment_methods.find((method) => method.id === 'method-2');
  assert.equal(row.status, 'archived');
});

test('portal autopay patch updates existing scoped settings row', async () => {
  const tables = basePaymentTables();
  const captures = { inserts: [], updates: [] };
  const buildRouter = loadPaymentMethodRouterWithSupabase(tables, captures);
  const app = buildPaymentMethodApp(buildRouter, { companyId: COMPANY_A, email: CUSTOMER_EMAIL, name: 'Buyer' });

  const res = await request(app, 'PATCH', '/api/portal/payments/autopay', {
    enabled: true,
    method_id: 'method-1',
    autopay_day_of_month: 15,
    max_amount: 500,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Autopay settings updated');
  assert.equal(res.body.autopay.enabled, true);
  assert.equal(res.body.autopay.method_id, 'method-1');
  assert.equal(res.body.autopay.autopay_day_of_month, 15);

  const updated = captures.updates.find((entry) => entry.table === 'portal_payment_settings' && entry.id === 'settings-1');
  assert.ok(updated, 'expected scoped autopay settings update');
  assert.equal(updated.patch.autopay_enabled, true);
  assert.equal(updated.patch.method_id, 'method-1');
});

test('timestamped migration creates portal payment tables before enabling RLS', () => {
  const migration = fs.readFileSync(
    path.join(repoRoot, 'supabase', 'migrations', '20260627_portal_payments_rls.sql'),
    'utf8'
  );
  const normalized = migration.toLowerCase();
  for (const table of ['portal_payment_methods', 'portal_payment_settings', 'portal_payment_events']) {
    const createMarker = `create table if not exists public.${table}`;
    const rlsMarker = `alter table public.${table} enable row level security`;
    const createPos = normalized.indexOf(createMarker);
    const rlsPos = normalized.indexOf(rlsMarker);
    assert.ok(createPos >= 0, `missing create table for ${table} in timestamped migration`);
    assert.ok(rlsPos > createPos, `${table} RLS must run after table creation`);
  }
});

test('customer portal frontend includes payment bootstrap and checkout trigger', () => {
  for (const marker of [
    '/api/portal/payments/config',
    '/api/portal/payments/profile',
    '/api/portal/payments/create-checkout-session',
    '/api/portal/payments/autopay/charge-now',
    'idempotency_key',
    'Stripe test mode preview — no live charges',
    "payment === 'success'",
    'Pay Now',
    'ach_bank',
    'autopay',
  ]) {
    assert.ok(portalFrontendSource.includes(marker), `missing customer portal payment marker ${marker}`);
  }
});

// ── Request-level integration tests ──────────────────────────────────────────
// Previously this suite only asserted on source markers, which is why the
// runtime `scopeQueryByContext is not a function` regression on DELETE/PATCH
// passed CI. These tests exercise the real router against a fake Supabase and
// a spy on scopeQueryByContext so behavioral regressions are caught.
function makeScopedSupabase(tables, captures) {
  class Query {
    constructor(table) {
      this.table = table;
      this.rows = [...(tables[table] || [])];
      this.singleRow = false;
      this.op = 'select';
      this._update = null;
    }
    select() { return this; }
    order() { return this; }
    limit(n) { this.rows = this.rows.slice(0, n); return this; }
    eq(field, value) {
      this.rows = this.rows.filter((row) => String(row[field] ?? '') === String(value ?? ''));
      return this;
    }
    insert(records) {
      this.op = 'insert';
      const arr = (Array.isArray(records) ? records : [records]).map((r, i) => ({ id: r.id || `${this.table}-new-${i + 1}`, ...r }));
      (tables[this.table] = tables[this.table] || []).push(...arr);
      if (captures) captures.inserts.push(...arr.map((row) => ({ table: this.table, row })));
      this.rows = arr;
      return this;
    }
    update(patch) {
      this.op = 'update';
      this._update = patch;
      if (captures) captures.updates.push({ table: this.table, patch });
      return this;
    }
    single() { this.singleRow = true; return this; }
    then(resolve, reject) {
      if (this.op === 'update' && this._update) {
        const tableRows = tables[this.table] || [];
        for (const row of this.rows) {
          const target = tableRows.find((r) => r.id === row.id);
          if (target) Object.assign(target, this._update);
        }
        this.rows = this.rows.map((r) => ({ ...r, ...this._update }));
      }
      const data = this.singleRow ? (this.rows[0] || null) : this.rows;
      const error = this.singleRow && !this.rows.length ? { code: 'PGRST116', message: 'no rows' } : null;
      return Promise.resolve({ data, error }).then(resolve, reject);
    }
  }
  return { from: (table) => new Query(table) };
}

const COMPANY = 'company-a';
const EMAIL = 'buyer@example.test';

function loadPaymentMethodRouter(tables, captures, scopeCalls) {
  const supabasePath = require.resolve('../services/supabase');
  const ocPath = require.resolve('../services/operating-context');

  // Override the supabase service so loadPortalPaymentState + helpers use the fake.
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { supabase: makeScopedSupabase(tables, captures), dbQuery: async () => null },
  };

  // Load operating-context fresh and wrap scopeQueryByContext with a spy that
  // records (context, options) while delegating to the real implementation.
  delete require.cache[ocPath];
  const realOc = require('../services/operating-context');
  const spied = {
    ...realOc,
    scopeQueryByContext(query, context, options) {
      scopeCalls.push({ context, options });
      return realOc.scopeQueryByContext(query, context, options);
    },
  };
  require.cache[ocPath].exports = spied;

  delete require.cache[require.resolve('../routes/portal/payments-shared')];
  delete require.cache[require.resolve('../routes/portal/payment-method-routes')];
  return require('../routes/portal/payment-method-routes');
}

function buildApp(buildRouter) {
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, _res, next) => {
    req.customerEmail = EMAIL;
    req.customerName = 'Buyer';
    req.portalContext = {
      companyId: COMPANY,
      activeCompanyId: COMPANY,
      activeLocationId: null,
      accessibleLocationIds: [],
      accessibleCompanyIds: [COMPANY],
      isGlobalOperator: false,
    };
    next();
  };
  app.use('/api/portal', buildRouter({ authenticatePortalToken: fakeAuth }));
  return app;
}

function request(app, method, pathName, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({ port, method, path: pathName, headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { /* non-json */ }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function methodRow(overrides = {}) {
  return {
    id: 'pm-1',
    company_id: COMPANY,
    customer_email: EMAIL,
    method_type: 'ach_bank',
    provider: 'manual',
    payment_method_ref: 'ref-1',
    is_default: true,
    status: 'active',
    account_last4: '4321',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('POST /payments/methods saves a new ACH method and returns it', async () => {
  const tables = { portal_payment_methods: [], portal_payment_settings: [] };
  const captures = { inserts: [], updates: [] };
  const scopeCalls = [];
  const router = loadPaymentMethodRouter(tables, captures, scopeCalls);
  const app = buildApp(router);

  const res = await request(app, 'POST', '/api/portal/payments/methods', {
    method_type: 'ach_bank',
    provider: 'manual',
    payment_method_ref: 'ref-new',
    account_last4: '9999',
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Payment method saved');
  assert.equal(res.body.method.method_type, 'ach_bank');
  assert.equal(res.body.method.account_last4, '9999');
  // First method is forced default and persisted with the tenant company_id.
  assert.equal(captures.inserts.length, 1);
  assert.equal(captures.inserts[0].row.company_id, COMPANY);
});

test('DELETE /payments/methods/:id archives the method via scoped query', async () => {
  const tables = {
    portal_payment_methods: [methodRow(), methodRow({ id: 'pm-2', is_default: false, payment_method_ref: 'ref-2' })],
    portal_payment_settings: [],
  };
  const captures = { inserts: [], updates: [] };
  const scopeCalls = [];
  const router = loadPaymentMethodRouter(tables, captures, scopeCalls);
  const app = buildApp(router);

  const res = await request(app, 'DELETE', '/api/portal/payments/methods/pm-1');

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Payment method removed');
  // scopeQueryByContext must have been called (regression guard) with the tenant context.
  assert.ok(scopeCalls.length >= 1, 'scopeQueryByContext was not called on the delete path');
  assert.equal(scopeCalls[0].context.activeCompanyId, COMPANY);
  // The targeted row is archived in the underlying table.
  const archived = tables.portal_payment_methods.find((m) => m.id === 'pm-1');
  assert.equal(archived.status, 'archived');
});

test('PATCH /payments/autopay inserts a new settings row (new-row path)', async () => {
  const tables = {
    portal_payment_methods: [methodRow()],
    portal_payment_settings: [],
  };
  const captures = { inserts: [], updates: [] };
  const scopeCalls = [];
  const router = loadPaymentMethodRouter(tables, captures, scopeCalls);
  const app = buildApp(router);

  const res = await request(app, 'PATCH', '/api/portal/payments/autopay', {
    enabled: true,
    method_id: 'pm-1',
    autopay_day_of_month: 5,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.autopay.enabled, true);
  assert.equal(res.body.autopay.method_id, 'pm-1');
  // No existing row → insert path.
  assert.equal(captures.inserts.filter((i) => i.table === 'portal_payment_settings').length, 1);
});

test('PATCH /payments/autopay updates an existing settings row via scoped query (existing-row path)', async () => {
  const tables = {
    portal_payment_methods: [methodRow()],
    portal_payment_settings: [{
      id: 'set-1',
      company_id: COMPANY,
      customer_email: EMAIL,
      autopay_enabled: false,
      autopay_day_of_month: 1,
      method_id: null,
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
  };
  const captures = { inserts: [], updates: [] };
  const scopeCalls = [];
  const router = loadPaymentMethodRouter(tables, captures, scopeCalls);
  const app = buildApp(router);

  const res = await request(app, 'PATCH', '/api/portal/payments/autopay', {
    enabled: true,
    method_id: 'pm-1',
    autopay_day_of_month: 10,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.autopay.enabled, true);
  assert.equal(res.body.autopay.autopay_day_of_month, 10);
  // Existing-row path must go through scopeQueryByContext (the regression site).
  assert.ok(scopeCalls.length >= 1, 'scopeQueryByContext was not called on the existing-row autopay path');
  assert.equal(scopeCalls[0].context.activeCompanyId, COMPANY);
  // No insert happened; the existing row was updated in place.
  assert.equal(captures.inserts.filter((i) => i.table === 'portal_payment_settings').length, 0);
  const updated = tables.portal_payment_settings.find((s) => s.id === 'set-1');
  assert.equal(updated.autopay_enabled, true);
});
