const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const express = require('express');
const cookieParser = require('cookie-parser');

const authPath = require.resolve('../routes/auth');
const routesPath = require.resolve('../routes/routes');
const middlewarePath = require.resolve('../middleware/auth');
const supabasePath = require.resolve('../services/supabase');
const configPath = require.resolve('../lib/config');

function clearBackendModuleCache() {
  for (const modulePath of [authPath, routesPath, middlewarePath, supabasePath, configPath]) {
    delete require.cache[modulePath];
  }
}

async function startHarness(t) {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-driver-auth-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'driver-auth-contract-test-secret';
  clearBackendModuleCache();

  const { supabase } = require('../services/supabase');
  const driver = {
    id: 'driver-contract-001',
    name: 'Casey Driver',
    email: 'casey.driver@noderoute.test',
    password_hash: bcrypt.hashSync('DriverPass123!', 10),
    role: 'driver',
    status: 'active',
    company_id: 'company-contract-001',
  };
  const route = {
    id: 'route-contract-001',
    name: 'Contract Route',
    driver_id: driver.id,
    company_id: driver.company_id,
    stop_ids: [],
    active_stop_ids: [],
  };

  await supabase.from('users').insert(driver);
  await supabase.from('routes').insert(route);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/auth', require('../routes/auth'));
  app.use('/api/routes', require('../routes/routes'));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    route,
  };
}

test('driver login returns bearer tokens and bearer token can load an assigned route', async (t) => {
  const harness = await startHarness(t);

  const loginResponse = await fetch(`${harness.baseUrl}/auth/driver/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'casey.driver@noderoute.test',
      password: 'DriverPass123!',
    }),
  });

  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.headers.get('set-cookie'), null);
  const loginBody = await loginResponse.json();
  assert.equal(typeof loginBody.token, 'string');
  assert.equal(typeof loginBody.refreshToken, 'string');
  assert.equal(loginBody.user.email, 'casey.driver@noderoute.test');

  const routeResponse = await fetch(`${harness.baseUrl}/api/routes/${harness.route.id}`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(routeResponse.status, 200);
  const routeBody = await routeResponse.json();
  assert.equal(routeBody.id, harness.route.id);
});
