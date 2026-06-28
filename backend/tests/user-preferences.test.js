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
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}user-preferences.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withPreferenceApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-user-prefs-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const router = require('../routes/user-preferences');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([
      {
        id: 'prefs-user-a',
        name: 'Prefs User A',
        email: 'prefs-a@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-prefs-a',
        location_id: 'location-prefs-a',
      },
      {
        id: 'prefs-user-b',
        name: 'Prefs User B',
        email: 'prefs-b@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-prefs-b',
        location_id: 'location-prefs-b',
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/user-preferences', router);
    app.use('/api/dashboard-layouts', router.dashboardLayoutsRouter);
    server = await listen(app);

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokenFor = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '1h' });
    await fn({ baseUrl, supabase, tokenFor });
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

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

test('user navigation preferences reject invalid nav item ids', async () => {
  await withPreferenceApp(async ({ baseUrl, tokenFor }) => {
    const response = await fetch(`${baseUrl}/api/user-preferences/navigation`, {
      method: 'PUT',
      headers: authHeaders(tokenFor('prefs-user-a')),
      body: JSON.stringify({ nav_item_ids: ['dashboard', 'not-a-real-nav-id'] }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /unknown nav item id/i);
  });
});

test('user navigation preferences round-trip save and load for the current user', async () => {
  await withPreferenceApp(async ({ baseUrl, tokenFor }) => {
    const token = tokenFor('prefs-user-a');
    const navItemIds = ['orders', 'dashboard', 'inventory'];

    const saveResponse = await fetch(`${baseUrl}/api/user-preferences/navigation`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ nav_item_ids: navItemIds }),
    });
    assert.equal(saveResponse.status, 200);

    const loadResponse = await fetch(`${baseUrl}/api/user-preferences/navigation`, {
      headers: authHeaders(token),
    });
    assert.equal(loadResponse.status, 200);
    const body = await loadResponse.json();
    assert.deepEqual(body.nav_item_ids, navItemIds);
  });
});

test('user navigation preferences do not leak rows from another company', async () => {
  await withPreferenceApp(async ({ baseUrl, supabase, tokenFor }) => {
    await supabase.from('user_menu_preferences').insert({
      id: 'foreign-pref',
      company_id: 'company-prefs-a',
      user_id: 'prefs-user-b',
      nav_item_ids: ['dashboard', 'orders'],
      updated_at: '2026-06-28T00:00:00.000Z',
    });

    const response = await fetch(`${baseUrl}/api/user-preferences/navigation`, {
      headers: authHeaders(tokenFor('prefs-user-b')),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.nav_item_ids, []);
  });
});
