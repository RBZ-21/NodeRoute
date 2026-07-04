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

test('driver access token for Route A cannot access Route B stops or invoices', async () => {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-driver-token-scope-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'driver-token-scope-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');

    await supabase.from('users').insert([
      {
        id: 'driver-a',
        name: 'Driver A',
        email: 'driver.a@noderoute.test',
        role: 'driver',
        status: 'active',
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
      {
        id: 'driver-b',
        name: 'Driver B',
        email: 'driver.b@noderoute.test',
        role: 'driver',
        status: 'active',
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
    ]);

    await supabase.from('routes').insert([
      {
        id: 'route-a',
        name: 'Route A',
        driver_id: 'driver-a',
        driver: 'Driver A',
        stop_ids: ['stop-a'],
        active_stop_ids: ['stop-a'],
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
      {
        id: 'route-b',
        name: 'Route B',
        driver_id: 'driver-b',
        driver: 'Driver B',
        stop_ids: ['stop-b'],
        active_stop_ids: ['stop-b'],
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
    ]);

    await supabase.from('stops').insert([
      {
        id: 'stop-a',
        name: 'Route A Stop',
        route_id: 'route-a',
        driver_id: 'driver-a',
        invoice_id: 'invoice-a',
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
      {
        id: 'stop-b',
        name: 'Route B Stop',
        route_id: 'route-b',
        driver_id: 'driver-b',
        invoice_id: 'invoice-b',
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
    ]);

    await supabase.from('invoices').insert([
      {
        id: 'invoice-a',
        invoice_number: 'INV-A',
        customer_name: 'Route A Stop',
        route_id: 'route-a',
        status: 'sent',
        total: 10,
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
      {
        id: 'invoice-b',
        invoice_number: 'INV-B',
        customer_name: 'Route B Stop',
        route_id: 'route-b',
        status: 'sent',
        total: 20,
        company_id: 'driver-company',
        location_id: 'driver-location',
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/stops', require('../routes/stops'));
    app.use('/api/driver', require('../routes/driver'));
    app.use('/api/invoices', require('../routes/invoices'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'driver-a' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const headers = { Authorization: `Bearer ${token}` };

    const ownStopResponse = await fetch(`${baseUrl}/api/stops/stop-a`, { headers });
    assert.equal(ownStopResponse.status, 200);

    const foreignStopResponse = await fetch(`${baseUrl}/api/stops/stop-b`, { headers });
    assert.equal(foreignStopResponse.status, 403);

    const invoiceListResponse = await fetch(`${baseUrl}/api/driver/invoices`, { headers });
    assert.equal(invoiceListResponse.status, 200);
    const invoiceList = await invoiceListResponse.json();
    assert.deepEqual(invoiceList.map((invoice) => invoice.id), ['invoice-a']);

    const foreignInvoicePdfResponse = await fetch(`${baseUrl}/api/invoices/invoice-b/pdf`, { headers });
    assert.equal(foreignInvoicePdfResponse.status, 403);

    const expiredToken = jwt.sign({ userId: 'driver-a' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const expiredResponse = await fetch(`${baseUrl}/api/stops/stop-a`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredResponse.status, 401);
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
