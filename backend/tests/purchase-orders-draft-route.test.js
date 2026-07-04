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
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}purchase-orders.js`)
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

test('POST /api/purchase-orders/draft creates a scoped draft purchase order', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-po-draft-route-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'po-draft-route-test-secret';
  process.env.NODE_ENV = 'test';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'po-admin',
      name: 'PO Admin',
      email: 'po.admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-po',
      location_id: 'loc-po',
      accessible_company_ids: ['company-po'],
      accessible_location_ids: ['loc-po'],
    });

    const app = express();
    app.use(express.json());
    app.use('/api/purchase-orders', require('../routes/purchase-orders'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'po-admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = await fetch(`${baseUrl}/api/purchase-orders/draft`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor: 'Ocean Fresh Seafood',
        items: [{ item_number: 'SAL-01', description: 'Atlantic Salmon', quantity: 10, unit_cost: 5.5 }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vendor, 'Ocean Fresh Seafood');
    assert.equal(body.status, 'draft');
    assert.ok(body.po_number, 'expected an auto-generated PO number');
    assert.equal(body.company_id, 'company-po');

    const stored = await supabase.from('purchase_orders').select('*').eq('id', body.id).single();
    assert.equal(stored.data.status, 'draft');
    assert.equal(stored.data.location_id, 'loc-po');
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});

test('POST /api/purchase-orders/draft rejects a request with no line items', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-po-draft-empty-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'po-draft-empty-test-secret';
  process.env.NODE_ENV = 'test';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'po-admin-2', name: 'PO Admin 2', email: 'po.admin2@noderoute.test',
      role: 'admin', status: 'active', company_id: 'company-po-2', location_id: 'loc-po-2',
      accessible_company_ids: ['company-po-2'], accessible_location_ids: ['loc-po-2'],
    });

    const app = express();
    app.use(express.json());
    app.use('/api/purchase-orders', require('../routes/purchase-orders'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'po-admin-2' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = await fetch(`${baseUrl}/api/purchase-orders/draft`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor: 'Empty Vendor', items: [] }),
    });
    assert.equal(response.status, 400);
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
