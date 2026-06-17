'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const supabasePath = require.resolve('../services/supabase');

// ── Fake Supabase ────────────────────────────────────────────────────────────
// Minimal query builder covering the calls portal-ordering + the gate make:
//   companies: select().eq().single()
//   products:  select().or().order()  /  select().or()
//   orders:    select().eq().eq().single()  /  insert().select().single()
function makeSupabase(tables, captures) {
  class Query {
    constructor(table) {
      this.table = table;
      this.rows = [...(tables[table] || [])];
      this.singleRow = false;
      this.inserting = null;
    }
    select() { return this; }
    or() { return this; }
    order() { return this; }
    eq(field, value) {
      this.rows = this.rows.filter((row) => String(row[field] ?? '') === String(value ?? ''));
      return this;
    }
    insert(records) {
      this.inserting = (Array.isArray(records) ? records : [records]).map((r, i) => ({ id: `new-order-${i + 1}`, ...r }));
      if (captures) captures.inserts.push(...this.inserting.map((r) => ({ table: this.table, row: r })));
      (tables[this.table] = tables[this.table] || []).push(...this.inserting);
      this.rows = this.inserting;
      return this;
    }
    single() { this.singleRow = true; return this; }
    then(resolve) {
      const data = this.singleRow ? (this.rows[0] || null) : this.rows;
      const error = this.singleRow && !this.rows.length ? { code: 'PGRST116', message: 'no rows' } : null;
      return Promise.resolve({ data, error }).then(resolve);
    }
  }
  return { from: (table) => new Query(table) };
}

function loadRouterWithSupabase(tables, captures) {
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { supabase: makeSupabase(tables, captures), dbQuery: async () => null },
  };
  // operating-context closes over its own require of supabase, but it only
  // receives the supabase instance as an argument for inserts, so the fake flows through.
  delete require.cache[require.resolve('../routes/portal-ordering')];
  delete require.cache[require.resolve('../routes/portal/shared')];
  return require('../routes/portal-ordering');
}

// Build an app that stubs portal auth for a given company/customer, then mounts
// the real router (with the real requirePortalOrdering gate).
function buildApp(buildPortalOrderingRouter, { companyId, email, name }) {
  const { requirePortalOrdering } = require('../routes/portal/shared');
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
  app.use('/api/portal', buildPortalOrderingRouter({ authenticatePortalToken: fakeAuth, requirePortalOrdering }));
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({ port, method, path, headers: { 'Content-Type': 'application/json' } }, (res) => {
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

const COMPANY_ON = 'company-on';
const COMPANY_OFF = 'company-off';

function baseTables() {
  return {
    companies: [
      { id: COMPANY_ON, portal_ordering_enabled: true },
      { id: COMPANY_OFF, portal_ordering_enabled: false },
    ],
    products: [
      { id: 'p1', item_number: 'SAL-01', description: 'Salmon', category: 'Fish', unit: 'lb', price_per_unit: 12, on_hand_qty: 50, company_id: COMPANY_ON, is_active: true },
      { id: 'p2', item_number: 'TUN-01', description: 'Tuna', category: 'Fish', unit: 'lb', price_per_unit: 18, on_hand_qty: 0, company_id: COMPANY_ON, is_active: true },
      { id: 'p9', item_number: 'OTH-01', description: 'Other Co Item', category: 'Fish', unit: 'lb', price_per_unit: 9, on_hand_qty: 99, company_id: 'company-other', is_active: true },
    ],
    orders: [],
  };
}

test('portal ordering endpoints return 403 FEATURE_NOT_ENABLED when the add-on is off', async () => {
  const tables = baseTables();
  const buildRouter = loadRouterWithSupabase(tables);
  const app = buildApp(buildRouter, { companyId: COMPANY_OFF, email: 'buyer@x.test', name: 'Buyer' });

  const catalog = await request(app, 'GET', '/api/portal/catalog');
  assert.equal(catalog.status, 403);
  assert.equal(catalog.body.code, 'FEATURE_NOT_ENABLED');

  const submit = await request(app, 'POST', '/api/portal/orders/submit', { items: [{ product_id: 'p1', quantity: 2 }] });
  assert.equal(submit.status, 403);
  assert.equal(submit.body.code, 'FEATURE_NOT_ENABLED');
});

test('catalog returns only the company in-stock items with addable flags when enabled', async () => {
  const tables = baseTables();
  const buildRouter = loadRouterWithSupabase(tables);
  const app = buildApp(buildRouter, { companyId: COMPANY_ON, email: 'buyer@x.test', name: 'Buyer' });

  const res = await request(app, 'GET', '/api/portal/catalog');
  assert.equal(res.status, 200);
  // Other company's item must never appear (no cross-company leakage).
  assert.ok(!res.body.some((i) => i.item_number === 'OTH-01'));
  const salmon = res.body.find((i) => i.item_number === 'SAL-01');
  const tuna = res.body.find((i) => i.item_number === 'TUN-01');
  assert.equal(salmon.addable, true);
  assert.equal(tuna.stock_state, 'out_of_stock');
  assert.equal(tuna.addable, false);
});

test('submitting a cart creates a pending portal order with server-side pricing', async () => {
  const tables = baseTables();
  const captures = { inserts: [] };
  const buildRouter = loadRouterWithSupabase(tables, captures);
  const app = buildApp(buildRouter, { companyId: COMPANY_ON, email: 'buyer@x.test', name: 'Buyer' });

  const res = await request(app, 'POST', '/api/portal/orders/submit', {
    items: [{ product_id: 'p1', quantity: 3, unit_price: 1 /* client price must be ignored */ }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'pending');
  assert.equal(res.body.source, 'portal');
  assert.equal(res.body.items[0].unit_price, 12); // standard catalog price, not the client's 1

  const inserted = captures.inserts.find((c) => c.table === 'orders');
  assert.equal(inserted.row.source, 'portal');
  assert.equal(inserted.row.company_id, COMPANY_ON);
});

test('out-of-stock items cannot be submitted', async () => {
  const tables = baseTables();
  const buildRouter = loadRouterWithSupabase(tables);
  const app = buildApp(buildRouter, { companyId: COMPANY_ON, email: 'buyer@x.test', name: 'Buyer' });

  const res = await request(app, 'POST', '/api/portal/orders/submit', { items: [{ product_id: 'p2', quantity: 1 }] });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'OUT_OF_STOCK');
});
