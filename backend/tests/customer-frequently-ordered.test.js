'use strict';

// Focused tests for GET /api/customers/:id/frequently-ordered — a
// customer-specific "frequently ordered" insight derived from that
// customer's own order history over a trailing 90-day window. Aggregation
// and the 90-day cutoff are computed server-side so results are consistent
// and testable (never derived from a partially loaded frontend orders page).

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

async function setupApp() {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-customer-frequently-ordered-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'customer-frequently-ordered-test-secret';
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

async function seedAdmin(supabase, { id, companyId, locationId }) {
  await supabase.from('users').insert([
    {
      id, name: id, email: `${id}@noderoute.test`, role: 'admin', status: 'active',
      company_id: companyId, location_id: locationId,
      accessible_company_ids: [companyId], accessible_location_ids: [locationId],
    },
  ]);
}

test('aggregates qualifying orders and ranks items by order count, excluding cancelled orders and orders outside the 90-day window', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    // Captured once each so seeding and assertions compare the exact same
    // string — calling daysAgoIso() again later would drift by milliseconds.
    const fiveDaysAgo = daysAgoIso(5);
    const tenDaysAgo = daysAgoIso(10);
    const fifteenDaysAgo = daysAgoIso(15);
    const twentyFiveDaysAgo = daysAgoIso(25);
    const thirtyFiveDaysAgo = daysAgoIso(35);
    const hundredDaysAgo = daysAgoIso(100);

    await seedAdmin(supabase, { id: 'admin-a', companyId: 'company-a', locationId: 'loc-a' });
    await supabase.from('Customers').insert([
      { id: 'cust-1', company_name: 'Blue Fin Seafood', company_id: 'company-a', location_id: 'loc-a' },
    ]);
    await supabase.from('orders').insert([
      // Halibut: 3 qualifying orders, total qty 22, most recent 5 days ago.
      { id: 'o-a', order_number: 'ORD-A', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: fiveDaysAgo, items: [{ product_id: 'p-hal', item_number: 'HAL-001', description: 'Halibut', quantity: 10 }] },
      { id: 'o-b', order_number: 'ORD-B', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'invoiced', created_at: fifteenDaysAgo, items: [{ product_id: 'p-hal', item_number: 'HAL-001', description: 'Halibut', quantity: 8 }] },
      { id: 'o-c', order_number: 'ORD-C', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'pending', created_at: twentyFiveDaysAgo, items: [{ product_id: 'p-hal', item_number: 'HAL-001', description: 'Halibut', quantity: 4 }] },
      // Salmon: 2 qualifying orders, total qty 40, most recent 10 days ago.
      { id: 'o-d', order_number: 'ORD-D', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'in_process', created_at: tenDaysAgo, items: [{ product_id: 'p-sal', item_number: 'SAL-001', description: 'Salmon', quantity: 20 }] },
      { id: 'o-e', order_number: 'ORD-E', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'processed', created_at: thirtyFiveDaysAgo, items: [{ product_id: 'p-sal', item_number: 'SAL-001', description: 'Salmon', quantity: 20 }] },
      // Cod: outside the 90-day window entirely — must be excluded despite a huge quantity.
      { id: 'o-f', order_number: 'ORD-F', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: hundredDaysAgo, items: [{ product_id: 'p-cod', item_number: 'COD-001', description: 'Cod', quantity: 100 }] },
      // Tuna: within the window but cancelled — must be excluded despite a large quantity.
      { id: 'o-g', order_number: 'ORD-G', customer_id: 'cust-1', company_id: 'company-a', location_id: 'loc-a', status: 'cancelled', created_at: fiveDaysAgo, items: [{ product_id: 'p-tuna', item_number: 'TUN-001', description: 'Tuna', quantity: 50 }] },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-1/frequently-ordered`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.deepEqual(
      body.items.map((item) => item.description),
      ['Halibut', 'Salmon'],
      'Cod (outside window) and Tuna (cancelled) must not appear; Halibut (3 orders) outranks Salmon (2 orders)',
    );

    const [halibut, salmon] = body.items;
    assert.equal(halibut.item_number, 'HAL-001');
    assert.equal(halibut.product_id, 'p-hal');
    assert.equal(halibut.order_count, 3);
    assert.equal(halibut.total_quantity, 22);
    assert.equal(halibut.last_ordered_at, fiveDaysAgo);

    assert.equal(salmon.order_count, 2);
    assert.equal(salmon.total_quantity, 40);
    assert.equal(salmon.last_ordered_at, tenDaysAgo);

    const expectedWindowStart = Date.now() - 90 * 24 * 60 * 60 * 1000;
    assert.ok(
      Math.abs(new Date(body.window_start).getTime() - expectedWindowStart) < 10_000,
      `window_start should be ~90 days ago, got ${body.window_start}`,
    );
  } finally {
    await teardown();
  }
});

test('breaks order-count ties by total quantity, then recency, then name ascending', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await seedAdmin(supabase, { id: 'admin-a', companyId: 'company-a', locationId: 'loc-a' });
    await supabase.from('Customers').insert([
      { id: 'cust-2', company_name: 'Tie Break Test Co', company_id: 'company-a', location_id: 'loc-a' },
    ]);
    await supabase.from('orders').insert([
      { id: 'o-h', order_number: 'ORD-H', customer_id: 'cust-2', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(5), items: [
        { item_number: 'AAA', description: 'Apple', quantity: 5 },
        { item_number: 'BBB', description: 'Banana', quantity: 10 },
      ] },
      { id: 'o-i', order_number: 'ORD-I', customer_id: 'cust-2', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(20), items: [
        { item_number: 'CCC', description: 'Cherry', quantity: 5 },
      ] },
      { id: 'o-j', order_number: 'ORD-J', customer_id: 'cust-2', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(3), items: [
        { item_number: 'DDD', description: 'Date', quantity: 5 },
      ] },
      { id: 'o-k', order_number: 'ORD-K', customer_id: 'cust-2', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(7), items: [
        { item_number: 'ZZZ', description: 'Zucchini', quantity: 2 },
        { item_number: 'YYY', description: 'Yam', quantity: 2 },
      ] },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-2/frequently-ordered`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();

    // Every item here has order_count = 1, so the tie-break chain decides the
    // whole order: total_quantity desc (Banana=10 first; Apple/Cherry/Date=5
    // tie), then last_ordered_at desc among the qty=5 trio (Date 3d ago >
    // Apple 5d ago > Cherry 20d ago), then name asc among the qty=2 duo that
    // shares one order/timestamp (Yam < Zucchini).
    assert.deepEqual(
      body.items.map((item) => item.description),
      ['Banana', 'Date', 'Apple', 'Cherry', 'Yam', 'Zucchini'],
    );
    body.items.forEach((item) => assert.equal(item.order_count, 1));
  } finally {
    await teardown();
  }
});

test('excludes orders from before the 90-day window while including orders just inside it', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await seedAdmin(supabase, { id: 'admin-a', companyId: 'company-a', locationId: 'loc-a' });
    await supabase.from('Customers').insert([
      { id: 'cust-3', company_name: 'Cutoff Test Co', company_id: 'company-a', location_id: 'loc-a' },
    ]);
    await supabase.from('orders').insert([
      { id: 'o-recent', order_number: 'ORD-RECENT', customer_id: 'cust-3', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(89), items: [{ item_number: 'IN', description: 'Inside Window', quantity: 1 }] },
      { id: 'o-stale', order_number: 'ORD-STALE', customer_id: 'cust-3', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(91), items: [{ item_number: 'OUT', description: 'Outside Window', quantity: 1 }] },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-3/frequently-ordered`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map((item) => item.description), ['Inside Window']);
  } finally {
    await teardown();
  }
});

test('never leaks another tenant\'s frequently-ordered data', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await seedAdmin(supabase, { id: 'admin-b', companyId: 'company-b', locationId: 'loc-b' });
    await supabase.from('Customers').insert([
      { id: 'cust-a1', company_name: 'Tenant A Customer', company_id: 'company-a', location_id: 'loc-a' },
    ]);
    await supabase.from('orders').insert([
      { id: 'order-a1', order_number: 'ORD-A1', customer_id: 'cust-a1', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(1), items: [{ item_number: 'X', description: 'Secret Item', quantity: 1 }] },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-a1/frequently-ordered`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-b')}` },
    });
    assert.equal(response.status, 404, 'cross-tenant customer id must resolve as not-found, never leak insight data');
    const body = await response.json();
    assert.ok(body.error);
  } finally {
    await teardown();
  }
});

test('returns an empty items array (with a window_start) when the customer has no qualifying orders', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await seedAdmin(supabase, { id: 'admin-a', companyId: 'company-a', locationId: 'loc-a' });
    await supabase.from('Customers').insert([
      { id: 'cust-empty', company_name: 'No Recent Orders Co', company_id: 'company-a', location_id: 'loc-a' },
    ]);
    // Only order is outside the window, so it has zero *qualifying* orders.
    await supabase.from('orders').insert([
      { id: 'o-old', order_number: 'ORD-OLD', customer_id: 'cust-empty', company_id: 'company-a', location_id: 'loc-a', status: 'delivered', created_at: daysAgoIso(200), items: [{ item_number: 'X', description: 'Ancient Item', quantity: 1 }] },
    ]);

    const response = await fetch(`${baseUrl}/api/customers/cust-empty/frequently-ordered`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items, []);
    assert.ok(body.window_start, 'expected a window_start even for an empty result');
  } finally {
    await teardown();
  }
});

test('returns a clear 404 for an unknown customer id', async () => {
  const { supabase, baseUrl, teardown } = await setupApp();
  try {
    await seedAdmin(supabase, { id: 'admin-a', companyId: 'company-a', locationId: 'loc-a' });

    const response = await fetch(`${baseUrl}/api/customers/does-not-exist/frequently-ordered`, {
      headers: { Authorization: `Bearer ${tokenFor('admin-a')}` },
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error);
  } finally {
    await teardown();
  }
});
