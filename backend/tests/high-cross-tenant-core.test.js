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

test('core tenant endpoints reject forged-header access to foreign resource ids without mutation', async () => {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-cross-tenant-core-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'cross-tenant-core-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');

    await supabase.from('users').insert([
      {
        id: 'tenant-a-admin',
        name: 'Tenant A Admin',
        email: 'tenant.a.admin@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-a',
        location_id: 'loc-a',
        accessible_company_ids: ['company-a'],
        accessible_location_ids: ['loc-a'],
      },
      {
        id: 'tenant-b-admin',
        name: 'Tenant B Admin',
        email: 'tenant.b.admin@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-b',
        location_id: 'loc-b',
        accessible_company_ids: ['company-b'],
        accessible_location_ids: ['loc-b'],
      },
      {
        id: 'tenant-b-driver',
        name: 'Tenant B Driver',
        email: 'tenant.b.driver@noderoute.test',
        role: 'driver',
        status: 'active',
        company_id: 'company-b',
        location_id: 'loc-b',
        accessible_company_ids: ['company-b'],
        accessible_location_ids: ['loc-b'],
      },
    ]);

    await supabase.from('Customers').insert([
      {
        id: 'customer-a',
        company_name: 'Tenant A Customer',
        company_id: 'company-a',
        location_id: 'loc-a',
      },
      {
        id: 'customer-b',
        company_name: 'Tenant B Customer',
        company_id: 'company-b',
        location_id: 'loc-b',
      },
    ]);

    await supabase.from('products').insert([
      {
        id: 'product-a',
        item_number: 'ITEM-A',
        name: 'Tenant A Product',
        description: 'Tenant A Product',
        company_id: 'company-a',
        location_id: 'loc-a',
      },
      {
        id: 'product-b',
        item_number: 'ITEM-B',
        name: 'Tenant B Product',
        description: 'Tenant B Product',
        company_id: 'company-b',
        location_id: 'loc-b',
      },
    ]);

    await supabase.from('inventory_lots').insert([
      {
        id: 'lot-a',
        item_number: 'ITEM-A',
        lot_number: 'LOT-A',
        qty_on_hand: 10,
        company_id: 'company-a',
        location_id: 'loc-a',
        status: 'active',
      },
      {
        id: 'lot-b',
        item_number: 'ITEM-B',
        lot_number: 'LOT-B',
        qty_on_hand: 20,
        company_id: 'company-b',
        location_id: 'loc-b',
        status: 'active',
      },
    ]);

    await supabase.from('orders').insert([
      {
        id: 'order-a',
        customer_name: 'Tenant A Customer',
        status: 'pending',
        items: [],
        company_id: 'company-a',
        location_id: 'loc-a',
      },
      {
        id: 'order-b',
        customer_name: 'Tenant B Customer',
        status: 'pending',
        items: [],
        company_id: 'company-b',
        location_id: 'loc-b',
      },
    ]);

    await supabase.from('invoices').insert([
      {
        id: 'invoice-a',
        customer_name: 'Tenant A Customer',
        status: 'sent',
        total: 100,
        company_id: 'company-a',
        location_id: 'loc-a',
      },
      {
        id: 'invoice-b',
        customer_name: 'Tenant B Customer',
        status: 'sent',
        total: 200,
        company_id: 'company-b',
        location_id: 'loc-b',
      },
    ]);

    await supabase.from('routes').insert([
      {
        id: 'route-a',
        name: 'Tenant A Route',
        status: 'pending',
        stop_ids: [],
        active_stop_ids: [],
        company_id: 'company-a',
        location_id: 'loc-a',
      },
      {
        id: 'route-b',
        name: 'Tenant B Route',
        status: 'pending',
        stop_ids: [],
        active_stop_ids: [],
        company_id: 'company-b',
        location_id: 'loc-b',
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/orders', require('../routes/orders'));
    app.use('/api/invoices', require('../routes/invoices'));
    app.use('/api/inventory', require('../routes/inventory'));
    app.use('/api/routes', require('../routes/routes'));
    app.use('/api/customers', require('../routes/customers'));
    app.use('/api/users', require('../routes/users'));

    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'tenant-a-admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-company-id': 'company-b',
      'x-location-id': 'loc-b',
    };
    const foreignScopeBody = {
      company_id: 'company-b',
      location_id: 'loc-b',
      companyId: 'company-b',
      locationId: 'loc-b',
    };

    const ownOrderResponse = await fetch(`${baseUrl}/api/orders/order-a`, { headers });
    assert.equal(ownOrderResponse.status, 200);

    const attempts = [
      ['GET foreign order', `${baseUrl}/api/orders/order-b`, { headers }],
      ['PATCH foreign order', `${baseUrl}/api/orders/order-b`, { method: 'PATCH', headers, body: JSON.stringify({ notes: 'hijacked' }) }],
      ['PATCH foreign invoice', `${baseUrl}/api/invoices/invoice-b`, { method: 'PATCH', headers, body: JSON.stringify({ notes: 'hijacked' }) }],
      ['PATCH foreign product', `${baseUrl}/api/inventory/ITEM-B`, { method: 'PATCH', headers, body: JSON.stringify({ description: 'Hijacked Product' }) }],
      ['PATCH foreign lot', `${baseUrl}/api/inventory/lots/lot-b`, { method: 'PATCH', headers, body: JSON.stringify({ qty_on_hand: 1 }) }],
      ['PATCH foreign route', `${baseUrl}/api/routes/route-b`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Hijacked Route' }) }],
      ['PATCH foreign customer', `${baseUrl}/api/customers/customer-b`, { method: 'PATCH', headers, body: JSON.stringify({ company_name: 'Hijacked Customer' }) }],
      ['PATCH foreign user', `${baseUrl}/api/users/tenant-b-driver`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Hijacked Driver' }) }],
    ];

    for (const [label, url, options] of attempts) {
      const response = await fetch(url, options);
      assert.notEqual(response.status, 200, `${label} unexpectedly returned 200`);
      assert.ok([403, 404].includes(response.status), `${label} returned ${response.status}`);
    }

    const createAttempts = [
      ['POST scoped order', `${baseUrl}/api/orders`, {
        customerName: 'Tenant A New Order',
        fulfillmentType: 'pickup',
        items: [],
        ...foreignScopeBody,
      }],
      ['POST scoped invoice', `${baseUrl}/api/invoices`, {
        customer_name: 'Tenant A New Invoice',
        items: [{ description: 'Line', quantity: 1, unit_price: 10, total: 10 }],
        total: 10,
        ...foreignScopeBody,
      }],
      ['POST scoped product', `${baseUrl}/api/inventory`, {
        item_number: 'ITEM-CROSS-A',
        description: 'Tenant A Cross Product',
        category: 'Seafood',
        on_hand_qty: 0,
        ...foreignScopeBody,
      }],
      ['POST scoped lot', `${baseUrl}/api/inventory/lots`, {
        item_number: 'ITEM-A',
        lot_number: 'LOT-CROSS-A',
        qty_received: 5,
        ...foreignScopeBody,
      }],
      ['POST scoped route', `${baseUrl}/api/routes`, {
        name: 'Tenant A Cross Route',
        stopIds: [],
        ...foreignScopeBody,
      }],
      ['POST scoped customer', `${baseUrl}/api/customers`, {
        company_name: 'Tenant A Cross Customer',
        ...foreignScopeBody,
      }],
    ];

    for (const [label, url, body] of createAttempts) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const text = await response.text();
      assert.ok([200, 201].includes(response.status), `${label} returned ${response.status}: ${text}`);
      const payload = JSON.parse(text);
      assert.equal(payload.company_id, 'company-a', `${label} did not preserve active company scope`);
      assert.equal(payload.location_id, 'loc-a', `${label} did not preserve active location scope`);
    }

    const inviteResponse = await fetch(`${baseUrl}/api/users/invite`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Tenant B Invite Attempt',
        email: 'tenant.b.invite.attempt@noderoute.test',
        role: 'driver',
        companyId: 'company-b',
        locationId: 'loc-b',
      }),
    });
    assert.equal(inviteResponse.status, 403);

    const { data: [foreignOrder] } = await supabase.from('orders').select('*').eq('id', 'order-b');
    const { data: [foreignInvoice] } = await supabase.from('invoices').select('*').eq('id', 'invoice-b');
    const { data: [foreignProduct] } = await supabase.from('products').select('*').eq('item_number', 'ITEM-B');
    const { data: [foreignLot] } = await supabase.from('inventory_lots').select('*').eq('id', 'lot-b');
    const { data: [foreignRoute] } = await supabase.from('routes').select('*').eq('id', 'route-b');
    const { data: [foreignCustomer] } = await supabase.from('Customers').select('*').eq('id', 'customer-b');
    const { data: [foreignUser] } = await supabase.from('users').select('*').eq('id', 'tenant-b-driver');

    assert.equal(foreignOrder.notes, undefined);
    assert.equal(foreignInvoice.notes, undefined);
    assert.equal(foreignProduct.name, 'Tenant B Product');
    assert.equal(Number(foreignLot.qty_on_hand), 20);
    assert.equal(foreignRoute.name, 'Tenant B Route');
    assert.equal(foreignCustomer.company_name, 'Tenant B Customer');
    assert.equal(foreignUser.name, 'Tenant B Driver');
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
