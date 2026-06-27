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
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-profile-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-method-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-collection-routes.js'),
]);
const reactSrcDir = path.join(repoRoot, 'frontend-v2', 'src');
const portalFrontendSource = [
  path.join(reactSrcDir, 'hooks', 'usePortalData.ts'),
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

test('customer portal frontend includes payment bootstrap and checkout trigger', () => {
  for (const marker of [
    '/api/portal/payments/config',
    '/api/portal/payments/profile',
    '/api/portal/payments/create-checkout-session',
    '/api/portal/payments/autopay/charge-now',
    'ach_bank',
    'autopay',
  ]) {
    assert.ok(portalFrontendSource.includes(marker), `missing customer portal payment marker ${marker}`);
  }
});
