const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const forecastPath = require.resolve('../routes/forecast');
const authPath = require.resolve('../middleware/auth');
const supabasePath = require.resolve('../services/supabase');
const configPath = require.resolve('../lib/config');
const aiPath = require.resolve('../services/ai');

function clearBackendModuleCache() {
  for (const modulePath of [forecastPath, authPath, supabasePath, configPath, aiPath]) {
    delete require.cache[modulePath];
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('forecast endpoints are tenant-scoped before aggregation and AI input', async () => {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-forecast-scope-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'forecast-scope-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    require.cache[aiPath] = {
      id: aiPath,
      filename: aiPath,
      loaded: true,
      exports: {
        forecastDemand: async (product, history, days) => ({
          product_id: product.item_number,
          product_name: product.description,
          forecast_period_days: days,
          history_count: history.length,
        }),
      },
    };

    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert([
      {
        id: 'forecast-manager-a',
        name: 'Forecast Manager A',
        email: 'forecast.manager.a@noderoute.test',
        role: 'manager',
        status: 'active',
        company_id: 'forecast-company-a',
        location_id: 'forecast-location-a',
      },
      {
        id: 'forecast-superadmin',
        name: 'Forecast Superadmin',
        email: 'forecast.superadmin@noderoute.test',
        role: 'superadmin',
        status: 'active',
      },
    ]);

    const recent = new Date(Date.now() - 2 * 86400000).toISOString();
    await supabase.from('orders').insert([
      {
        id: 'forecast-order-a',
        customer_name: 'Tenant A Customer',
        created_at: recent,
        company_id: 'forecast-company-a',
        location_id: 'forecast-location-a',
      },
      {
        id: 'forecast-order-b',
        customer_name: 'Tenant B Customer',
        created_at: recent,
        company_id: 'forecast-company-b',
        location_id: 'forecast-location-b',
      },
    ]);

    await supabase.from('products').insert([
      {
        id: 'forecast-product-a',
        item_number: 'SHARED-SKU',
        description: 'Tenant A Shared Fish',
        category: 'Seafood',
        unit: 'case',
        cost: 10,
        on_hand_qty: 4,
        company_id: 'forecast-company-a',
        location_id: 'forecast-location-a',
      },
      {
        id: 'forecast-product-b',
        item_number: 'SHARED-SKU',
        description: 'Tenant B Shared Fish',
        category: 'Seafood',
        unit: 'case',
        cost: 20,
        on_hand_qty: 8,
        company_id: 'forecast-company-b',
        location_id: 'forecast-location-b',
      },
      {
        id: 'forecast-product-b-only',
        item_number: 'TENANT-B-ONLY',
        description: 'Tenant B Private Fish',
        category: 'Seafood',
        unit: 'case',
        cost: 30,
        on_hand_qty: 12,
        company_id: 'forecast-company-b',
        location_id: 'forecast-location-b',
      },
    ]);

    await supabase.from('inventory_stock_history').insert([
      {
        id: 'forecast-history-a',
        item_number: 'SHARED-SKU',
        change_qty: -1,
        change_type: 'pick',
        created_at: recent,
        company_id: 'forecast-company-a',
        location_id: 'forecast-location-a',
      },
      {
        id: 'forecast-history-b-1',
        item_number: 'SHARED-SKU',
        change_qty: -2,
        change_type: 'pick',
        created_at: recent,
        company_id: 'forecast-company-b',
        location_id: 'forecast-location-b',
      },
      {
        id: 'forecast-history-b-2',
        item_number: 'SHARED-SKU',
        change_qty: -3,
        change_type: 'pick',
        created_at: recent,
        company_id: 'forecast-company-b',
        location_id: 'forecast-location-b',
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/forecast', require('../routes/forecast'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tenantToken = jwt.sign({ userId: 'forecast-manager-a' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const superadminToken = jwt.sign({ userId: 'forecast-superadmin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const tenantHeaders = { Authorization: `Bearer ${tenantToken}` };

    const ordersResponse = await fetch(`${baseUrl}/api/forecast/orders`, { headers: tenantHeaders });
    assert.equal(ordersResponse.status, 200);
    const ordersBody = await ordersResponse.json();
    assert.deepEqual(ordersBody.cadence.map((entry) => entry.customer), ['Tenant A Customer']);
    assert.equal(ordersBody.monthly.reduce((sum, bucket) => sum + bucket.count, 0), 1);

    const singleResponse = await fetch(`${baseUrl}/api/forecast/inventory/SHARED-SKU?days=7`, { headers: tenantHeaders });
    assert.equal(singleResponse.status, 200);
    const singleBody = await singleResponse.json();
    assert.equal(singleBody.product_name, 'Tenant A Shared Fish');
    assert.equal(singleBody.history_count, 1);

    const foreignResponse = await fetch(`${baseUrl}/api/forecast/inventory/TENANT-B-ONLY?days=7`, { headers: tenantHeaders });
    assert.equal(foreignResponse.status, 404);

    const batchResponse = await fetch(`${baseUrl}/api/forecast/inventory?days=7`, { headers: tenantHeaders });
    assert.equal(batchResponse.status, 200);
    const batchBody = await batchResponse.json();
    assert.deepEqual(batchBody.map((entry) => entry.product_name), ['Tenant A Shared Fish']);
    assert.equal(batchBody[0].history_count, 1);

    const superadminResponse = await fetch(`${baseUrl}/api/forecast/orders`, {
      headers: { Authorization: `Bearer ${superadminToken}` },
    });
    assert.equal(superadminResponse.status, 200);
    const superadminBody = await superadminResponse.json();
    assert.deepEqual(
      superadminBody.cadence.map((entry) => entry.customer).sort(),
      ['Tenant A Customer', 'Tenant B Customer']
    );
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
