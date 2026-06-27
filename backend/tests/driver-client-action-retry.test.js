const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const stopsPath = require.resolve('../routes/stops');
const middlewarePath = require.resolve('../middleware/auth');
const supabasePath = require.resolve('../services/supabase');
const configPath = require.resolve('../lib/config');
const clientActionPath = require.resolve('../lib/driver-client-action');

function clearBackendModuleCache() {
  for (const modulePath of [stopsPath, middlewarePath, supabasePath, configPath, clientActionPath]) {
    delete require.cache[modulePath];
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('failed driver stop action releases its client action id so retry can run', async () => {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-client-action-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'client-action-retry-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'driver-action-user',
      name: 'Driver Action',
      email: 'driver.action@noderoute.test',
      role: 'driver',
      status: 'active',
      company_id: 'action-company',
      location_id: 'action-location',
    });
    await supabase.from('routes').insert({
      id: 'action-route',
      name: 'Action Route',
      driver_id: 'driver-action-user',
      stop_ids: ['action-stop'],
      active_stop_ids: ['action-stop'],
      company_id: 'action-company',
      location_id: 'action-location',
    });
    await supabase.from('stops').insert({
      id: 'action-stop',
      name: 'Action Stop',
      address: '1 Retry Way',
      status: 'arrived',
      route_id: 'action-route',
      driver_id: 'driver-action-user',
      company_id: 'action-company',
      location_id: 'action-location',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/stops', require('../routes/stops'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'driver-action-user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = await fetch(`${baseUrl}/api/stops/action-stop/depart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Client-Action-Id': 'depart-retry-001',
      },
      body: JSON.stringify({ completion_type: 'signature' }),
    });

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'No open dwell record found — call /arrive first');

    const { data: markers } = await supabase
      .from('driver_client_actions')
      .select('*')
      .eq('user_id', 'driver-action-user')
      .eq('client_action_id', 'depart-retry-001');
    assert.deepEqual(markers, []);
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
