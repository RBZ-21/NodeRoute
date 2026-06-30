'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const COMPANY_ID = 'company-guides-a';
const LOCATION_ID = 'location-guides-a';

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}order-guides.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function withOrderGuideApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-order-guides-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const router = require('../routes/order-guides');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert({
      id: 'guide-admin',
      name: 'Guide Admin',
      email: 'guide-admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
    });

    const app = express();
    app.use(express.json());
    app.use('/api/order-guides', router);
    server = await listen(app);

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokenFor = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '1h' });
    await fn({ baseUrl, supabase, tokenFor });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('order guides return only active guides with items in configured sort order', async () => {
  await withOrderGuideApp(async ({ baseUrl, supabase, tokenFor }) => {
    await supabase.from('order_guides').insert([
      { id: 'guide-active', company_id: COMPANY_ID, customer_id: 'cust-guide-a', name: 'Weekly Seafood', is_active: true },
      { id: 'guide-inactive', company_id: COMPANY_ID, customer_id: 'cust-guide-a', name: 'Old Guide', is_active: false },
    ]);
    await supabase.from('order_guide_items').insert([
      { id: 'guide-item-2', company_id: COMPANY_ID, order_guide_id: 'guide-active', product_id: 'prod-b', sort_order: 2, default_qty: 4, default_uom: 'case' },
      { id: 'guide-item-1', company_id: COMPANY_ID, order_guide_id: 'guide-active', product_id: 'prod-a', sort_order: 1, default_qty: 2, default_uom: 'case' },
      { id: 'guide-item-old', company_id: COMPANY_ID, order_guide_id: 'guide-inactive', product_id: 'prod-old', sort_order: 1, default_qty: 1, default_uom: 'case' },
    ]);

    const response = await fetch(`${baseUrl}/api/order-guides?customerId=cust-guide-a`, {
      headers: authHeaders(tokenFor('guide-admin')),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.guides.map((guide) => guide.id), ['guide-active']);
    assert.deepEqual(body.guides[0].items.map((item) => item.product_id), ['prod-a', 'prod-b']);
  });
});
