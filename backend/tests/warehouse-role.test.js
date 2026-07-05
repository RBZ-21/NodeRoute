'use strict';

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
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}inventory.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}lots.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}kits.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}inventory-ledger.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withWarehouseApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-warehouse-role-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const inventoryRouter = require('../routes/inventory');
    const lotsRouter = require('../routes/lots');
    const kitsRouter = require('../routes/kits');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([{
      id: 'warehouse-worker',
      name: 'Warehouse Worker',
      email: 'warehouse-worker@noderoute.test',
      role: 'warehouse',
      status: 'active',
      company_id: 'company-warehouse-role',
      location_id: 'location-warehouse-role',
    }]);
    await supabase.from('products').insert([{
      id: 'product-warehouse-role-salmon',
      item_number: 'SAL-WHROLE',
      description: 'Warehouse Role Test Salmon',
      name: 'Warehouse Role Test Salmon',
      unit: 'lb',
      on_hand_qty: 10,
      cost: 5,
      company_id: 'company-warehouse-role',
      location_id: 'location-warehouse-role',
    }]);

    const app = express();
    app.use(express.json());
    app.use('/api/inventory', inventoryRouter);
    app.use('/api/lots', lotsRouter);
    app.use('/api/kits', kitsRouter);
    server = await listen(app);

    await fn({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      supabase,
      token: jwt.sign({ userId: 'warehouse-worker' }, jwtSecret, { expiresIn: '1h' }),
    });
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

test('warehouse role can restock inventory', async () => {
  await withWarehouseApp(async ({ baseUrl, token }) => {
    const res = await fetch(`${baseUrl}/api/inventory/SAL-WHROLE/restock`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ qty: 5 }),
    });
    assert.equal(res.status, 200, await res.text());
  });
});

test('warehouse role can trace a lot and pull the traceability report', async () => {
  await withWarehouseApp(async ({ baseUrl, token }) => {
    const trace = await fetch(`${baseUrl}/api/lots/SAL-WHROLE-DOES-NOT-EXIST/trace`, {
      headers: authHeaders(token),
    });
    // Not-found is fine here — the point is the role gate lets the request
    // through to the handler instead of stopping it with 403.
    assert.notEqual(trace.status, 403);

    const report = await fetch(`${baseUrl}/api/lots/traceability/report`, {
      headers: authHeaders(token),
    });
    assert.notEqual(report.status, 403);
  });
});

test('warehouse role can view kit recipes but cannot create one', async () => {
  await withWarehouseApp(async ({ baseUrl, token }) => {
    const view = await fetch(`${baseUrl}/api/kits/recipes`, { headers: authHeaders(token) });
    assert.equal(view.status, 200, await view.text());

    const create = await fetch(`${baseUrl}/api/kits/recipes`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Should be rejected',
        output_product_id: 'x',
        output_qty: 1,
        output_uom: 'ea',
        items: [{ input_product_id: 'product-warehouse-role-salmon', input_qty: 1, input_uom: 'lb' }],
      }),
    });
    assert.equal(create.status, 403);
  });
});
