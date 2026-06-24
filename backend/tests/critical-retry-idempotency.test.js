const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const modulePaths = [
  require.resolve('../routes/temperature-logs'),
  require.resolve('../routes/deliveries'),
  require.resolve('../lib/driver-client-action'),
  require.resolve('../middleware/auth'),
  require.resolve('../services/supabase'),
  require.resolve('../services/reorderEngine'),
  require.resolve('../lib/config'),
];

function clearBackendModuleCache() {
  for (const modulePath of modulePaths) {
    delete require.cache[modulePath];
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function resultChain(result) {
  return {
    select() { return this; },
    single() { return this; },
    eq() { return this; },
    limit() { return this; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    catch(reject) { return Promise.resolve(result).catch(reject); },
  };
}

function withDemoEnv(backupPath) {
  const keys = [
    'NODEROUTE_BACKUP_PATH',
    'NODEROUTE_FORCE_DEMO_MODE',
    'JWT_SECRET',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DEFAULT_COMPANY_ID',
    'DEFAULT_LOCATION_ID',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'critical-retry-idempotency-test-secret';
  process.env.SUPABASE_URL = 'http://supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.DEFAULT_COMPANY_ID = 'retry-company';
  process.env.DEFAULT_LOCATION_ID = 'retry-location';
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function installDriverActionStore(supabase, originalFrom) {
  const actions = new Set();
  supabase.from = (table) => {
    if (table !== 'driver_client_actions') return originalFrom(table);

    return {
      select() {
        const filters = {};
        const chain = {
          eq(field, value) {
            filters[field] = value;
            return chain;
          },
          limit() {
            return chain;
          },
          then(resolve, reject) {
            const key = `${filters.user_id}:${filters.client_action_id}`;
            const rows = actions.has(key) ? [{ id: `action-${actions.size}` }] : [];
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return chain;
      },
      insert(rows) {
        const row = Array.isArray(rows) ? rows[0] : rows;
        const key = `${row.user_id}:${row.client_action_id}`;
        if (actions.has(key)) {
          return resultChain({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
        }
        actions.add(key);
        return resultChain({ data: [row], error: null });
      },
    };
  };
  return actions;
}

test('driver client action id is not replayed after a failed temperature log write', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-temp-retry-'));
  const restoreEnv = withDemoEnv(backupPath);
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'retry-driver',
      name: 'Retry Driver',
      email: 'retry.driver@noderoute.test',
      role: 'driver',
      status: 'active',
      company_id: 'retry-company',
      location_id: 'retry-location',
    });

    const originalFrom = supabase.from.bind(supabase);
    let failTemperatureInsert = true;
    installDriverActionStore(supabase, (table) => {
      if (table === 'temperature_logs' && failTemperatureInsert) {
        return {
          insert() {
            failTemperatureInsert = false;
            return resultChain({ data: null, error: { message: 'simulated temperature insert failure' } });
          },
        };
      }
      return originalFrom(table);
    });

    const app = express();
    app.use(express.json());
    app.use('/api/temperature-logs', require('../routes/temperature-logs'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'retry-driver' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Client-Action-Id': 'temp-retry-action-1',
    };
    const body = JSON.stringify({ temperature: 34.5, storage_area: 'Truck', route_id: 'route-1', stop_id: 'stop-1' });

    const first = await fetch(`${baseUrl}/api/temperature-logs`, { method: 'POST', headers, body });
    assert.equal(first.status, 500);

    const retry = await fetch(`${baseUrl}/api/temperature-logs`, { method: 'POST', headers, body });
    assert.equal(retry.status, 200);
    const retryBody = await retry.json();
    assert.equal(retryBody.replay, undefined);
    assert.equal(retryBody.storage_area, 'Truck');

    const { data: logs } = await supabase.from('temperature_logs').select('*');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].temperature, 34.5);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    restoreEnv();
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});

test('delivery completion retry does not double-deduct inventory after status update failure', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-delivery-retry-'));
  const restoreEnv = withDemoEnv(backupPath);
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'retry-admin',
      name: 'Retry Admin',
      email: 'retry.admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'retry-company',
      location_id: 'retry-location',
    });
    await supabase.from('products').insert({
      id: 'retry-product',
      item_number: 'FISH-RETRY',
      name: 'Retry Fish',
      on_hand_qty: 100,
      cost: 10,
      company_id: 'retry-company',
      location_id: 'retry-location',
    });
    await supabase.from('orders').insert({
      id: 'retry-order',
      order_number: 'ORD-RETRY',
      status: 'in_process',
      customer_name: 'Retry Cafe',
      customer_address: '1 Retry Way',
      items: [{ product_id: 'retry-product', item_number: 'FISH-RETRY', quantity: 5 }],
      company_id: 'retry-company',
      location_id: 'retry-location',
    });

    const reorderEngine = require('../services/reorderEngine');
    reorderEngine.runReorderCheck = async () => ({ ok: true });

    const originalFrom = supabase.from.bind(supabase);
    let failOrderStatusUpdate = true;
    supabase.from = (table) => {
      const query = originalFrom(table);
      if (table !== 'orders') return query;
      const originalUpdate = query.update.bind(query);
      query.update = (payload) => {
        if (payload?.status === 'invoiced' && failOrderStatusUpdate) {
          failOrderStatusUpdate = false;
          return resultChain({ data: null, error: { message: 'simulated order status update failure' } });
        }
        return originalUpdate(payload);
      };
      return query;
    };

    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/deliveries'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'retry-admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ status: 'delivered' });

    const first = await fetch(`${baseUrl}/api/deliveries/retry-order/status`, { method: 'PATCH', headers, body });
    assert.equal(first.status, 500);

    const retry = await fetch(`${baseUrl}/api/deliveries/retry-order/status`, { method: 'PATCH', headers, body });
    assert.equal(retry.status, 200);

    const { data: product } = await supabase.from('products').select('*').eq('id', 'retry-product').single();
    assert.equal(product.on_hand_qty, 95);

    const { data: history } = await supabase
      .from('inventory_stock_history')
      .select('*')
      .eq('item_number', 'FISH-RETRY')
      .eq('change_type', 'delivery_complete');
    assert.equal(history.length, 1);
    assert.equal(history[0].change_qty, -5);

    const { data: order } = await supabase.from('orders').select('*').eq('id', 'retry-order').single();
    assert.equal(order.status, 'invoiced');
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    restoreEnv();
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
