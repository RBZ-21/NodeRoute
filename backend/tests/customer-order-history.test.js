'use strict';

// Focused tests for GET /api/customers/:id/orders — the new, more accessible
// entry point for a single customer's order history from the standard
// Customers page (in addition to, not instead of, the Sales Rep Hub's own
// /api/sales-reps/order-history/:customerId route, which is untouched).

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
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}`)
    ) {
      delete require.cache[key];
    }
  }
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

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Sets up an isolated demo-mode backend instance (fresh temp store + fresh
// module cache) and returns everything a test needs, plus a teardown().
async function setupApp() {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-customer-order-history-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'customer-order-history-test-secret';
  clearBackendModuleCache();

  const { supabase } = require('../services/supabase');
  const app = express();
  app.use(express.json());
  app.use('/api/customers', require('../routes/customers'));
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function teardown() {
    await close(server);
    process.env.NODEROUTE_BACKUP_PATH = previousEnv.NODEROUTE_BACKUP_PATH;
    process.env.NODEROUTE_FORCE_DEMO_MODE = previousEnv.NODEROUTE_FORCE_DEMO_MODE;
    process.env.JWT_SECRET = previousEnv.JWT_SECRET;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }

  return { supabase, app, server, baseUrl, teardown };
}

function tokenFor(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

test('GET /api/customers/:id/orders returns only the selected customer\'s orders, newest first', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await supabase.from('users').insert([
      {
        id: 'admin-a', name: 'Admin A', email: 'admin.a@noderoute.test', role: 'admin', status: 'active',
        company_id: 'company-a', location_id: 'loc-a',
        accessible_company_ids: ['company-a'], accessible_location_ids: ['loc-a'],
      },
    ]);
    await supabase.from('Customers').insert([
      { id: 'cust-1', company_name: 'Blue Fin Seafood', company_id: 'company-a', location_id: 'loc-a' },
      { id: 'cust-2', company_name: 'Harbor Cafe', company_id: 'company-a', location_id: 'loc-a' },
    ]);
    await supabase.from('orders').insert([
      { id: 'order-old', order_number: 'ORD-OLD', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', items: [], created_at: daysAgoIso(10) },
      { id: 'order-new', order_number: 'ORD-NEW', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'pending', items: [], created_at: daysAgoIso(1) },
      { id: 'order-other-customer', order_number: 'ORD-OTHER', customer_id: 'cust-2', company_id: 'company-a', location_id: 'loc-a', status: 'pending', items: [], created_at: daysAgoIso(1) },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-1/orders`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.map((o) => o.order_number), ['ORD-NEW', 'ORD-OLD'], 'expected only cust-1 orders, newest first');
  } finally {
    await teardown();
  }
});

test('GET /api/customers/:id/orders never returns another tenant\'s order history', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await supabase.from('users').insert([
      {
        id: 'admin-b', name: 'Admin B', email: 'admin.b@noderoute.test', role: 'admin', status: 'active',
        company_id: 'company-b', location_id: 'loc-b',
        accessible_company_ids: ['company-b'], accessible_location_ids: ['loc-b'],
      },
    ]);
    // Customer + orders belong to company-a; the requesting admin is company-b.
    await supabase.from('Customers').insert([
      { id: 'cust-a1', company_name: 'Tenant A Customer', company_id: 'company-a', location_id: 'loc-a' },
    ]);
    await supabase.from('orders').insert([
      { id: 'order-a1', order_number: 'ORD-A1', customer_id: 'cust-a1', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', items: [], created_at: daysAgoIso(1) },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-a1/orders`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-b')}` },
    });
    assert.equal(response.status, 404, 'cross-tenant customer id must resolve as not-found, never leak order rows');
    const body = await response.json();
    assert.ok(body.error, 'expected a clear error message');
  } finally {
    await teardown();
  }
});

test('GET /api/customers/:id/orders returns an empty array for a customer with no orders', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await supabase.from('users').insert([
      {
        id: 'admin-a', name: 'Admin A', email: 'admin.a@noderoute.test', role: 'admin', status: 'active',
        company_id: 'company-a', location_id: 'loc-a',
        accessible_company_ids: ['company-a'], accessible_location_ids: ['loc-a'],
      },
    ]);
    await supabase.from('Customers').insert([
      { id: 'cust-lonely', company_name: 'No Orders Yet Co', company_id: 'company-a', location_id: 'loc-a' },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-lonely/orders`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, []);
  } finally {
    await teardown();
  }
});

test('GET /api/customers/:id/orders returns a clear 404 for an unknown customer id', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await supabase.from('users').insert([
      {
        id: 'admin-a', name: 'Admin A', email: 'admin.a@noderoute.test', role: 'admin', status: 'active',
        company_id: 'company-a', location_id: 'loc-a',
        accessible_company_ids: ['company-a'], accessible_location_ids: ['loc-a'],
      },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/does-not-exist/orders`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error, 'expected a clear error message');
  } finally {
    await teardown();
  }
});
