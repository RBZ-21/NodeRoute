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

function clearBackendModuleCache() {
  for (const modulePath of [stopsPath, middlewarePath, supabasePath, configPath]) {
    delete require.cache[modulePath];
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('GET /api/stops/:id rejects cross-tenant stop reads', async (t) => {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-stop-scope-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'stop-detail-scope-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert([
      {
        id: 'stop-admin-a',
        name: 'Stop Admin A',
        email: 'stop.admin.a@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'stop-company-a',
        location_id: 'stop-location-a',
        accessible_company_ids: ['stop-company-a'],
        accessible_location_ids: ['stop-location-a'],
      },
      {
        id: 'stop-admin-b',
        name: 'Stop Admin B',
        email: 'stop.admin.b@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'stop-company-b',
        location_id: 'stop-location-b',
        accessible_company_ids: ['stop-company-b'],
        accessible_location_ids: ['stop-location-b'],
      },
    ]);
    await supabase.from('stops').insert([
      {
        id: 'tenant-a-stop',
        name: 'Tenant A Stop',
        address: '1 A Street',
        status: 'pending',
        company_id: 'stop-company-a',
        location_id: 'stop-location-a',
      },
      {
        id: 'tenant-b-stop',
        name: 'Tenant B Stop',
        address: '2 B Street',
        door_code: 'B-SECRET',
        status: 'pending',
        company_id: 'stop-company-b',
        location_id: 'stop-location-b',
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/stops', require('../routes/stops'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'stop-admin-a' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const headers = { Authorization: `Bearer ${token}` };

    const ownResponse = await fetch(`${baseUrl}/api/stops/tenant-a-stop`, { headers });
    assert.equal(ownResponse.status, 200);
    const ownStop = await ownResponse.json();
    assert.equal(ownStop.id, 'tenant-a-stop');

    const foreignResponse = await fetch(`${baseUrl}/api/stops/tenant-b-stop`, { headers });
    assert.equal(foreignResponse.status, 404);
    const foreignBody = await foreignResponse.json();
    assert.equal(foreignBody.error, 'Stop not found');
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
