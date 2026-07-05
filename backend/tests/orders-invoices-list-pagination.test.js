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
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}orders.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}invoices.js`)
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

test('GET /api/orders honors ORDERS_LIST_MAX_ROWS instead of returning every row', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-orders-pagination-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    ORDERS_LIST_MAX_ROWS: process.env.ORDERS_LIST_MAX_ROWS,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'orders-pagination-test-secret';
  process.env.ORDERS_LIST_MAX_ROWS = '2';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'pagination-admin',
      name: 'Pagination Admin',
      email: 'pagination.admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-pag',
      location_id: 'loc-pag',
      accessible_company_ids: ['company-pag'],
      accessible_location_ids: ['loc-pag'],
    });
    await supabase.from('orders').insert([
      { id: 'order-1', customer_name: 'A', status: 'pending', items: [], company_id: 'company-pag', location_id: 'loc-pag', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'order-2', customer_name: 'B', status: 'pending', items: [], company_id: 'company-pag', location_id: 'loc-pag', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'order-3', customer_name: 'C', status: 'pending', items: [], company_id: 'company-pag', location_id: 'loc-pag', created_at: '2026-01-03T00:00:00.000Z' },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/orders', require('../routes/orders'));

    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'pagination-admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const response = await fetch(`${baseUrl}/api/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 2, `expected ORDERS_LIST_MAX_ROWS=2 to cap the response, got ${body.length} rows`);
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

test('GET /api/invoices honors INVOICES_LIST_MAX_ROWS instead of returning every row', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-invoices-pagination-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    INVOICES_LIST_MAX_ROWS: process.env.INVOICES_LIST_MAX_ROWS,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'invoices-pagination-test-secret';
  process.env.INVOICES_LIST_MAX_ROWS = '2';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'pagination-admin-inv',
      name: 'Pagination Admin Invoices',
      email: 'pagination.admin.inv@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-pag-inv',
      location_id: 'loc-pag-inv',
      accessible_company_ids: ['company-pag-inv'],
      accessible_location_ids: ['loc-pag-inv'],
    });
    await supabase.from('invoices').insert([
      { id: 'invoice-1', customer_name: 'A', total: 10, items: [], company_id: 'company-pag-inv', location_id: 'loc-pag-inv', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'invoice-2', customer_name: 'B', total: 10, items: [], company_id: 'company-pag-inv', location_id: 'loc-pag-inv', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'invoice-3', customer_name: 'C', total: 10, items: [], company_id: 'company-pag-inv', location_id: 'loc-pag-inv', created_at: '2026-01-03T00:00:00.000Z' },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/invoices', require('../routes/invoices'));

    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'pagination-admin-inv' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const response = await fetch(`${baseUrl}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 2, `expected INVOICES_LIST_MAX_ROWS=2 to cap the response, got ${body.length} rows`);
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
