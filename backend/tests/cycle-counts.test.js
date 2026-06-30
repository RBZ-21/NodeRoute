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
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}cycle-counts.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}inventory-ledger.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withCycleCountApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-cycle-counts-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const cycleCountsRouter = require('../routes/cycle-counts');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([{
      id: 'cycle-admin',
      name: 'Cycle Admin',
      email: 'cycle-admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-cycle',
      location_id: 'location-cycle',
    }]);
    await supabase.from('products').insert([{
      id: 'product-cycle-salmon',
      item_number: 'SAL-CYCLE',
      description: 'Cycle Count Salmon',
      name: 'Cycle Count Salmon',
      unit: 'lb',
      on_hand_qty: 10,
      cost: 5,
      company_id: 'company-cycle',
      location_id: 'location-cycle',
    }]);

    const app = express();
    app.use(express.json());
    app.use('/api/cycle-counts', cycleCountsRouter);
    server = await listen(app);

    await fn({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      supabase,
      token: jwt.sign({ userId: 'cycle-admin' }, jwtSecret, { expiresIn: '1h' }),
    });
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

test('cycle count start, submit, and commit posts variance ledger entries', async () => {
  await withCycleCountApp(async ({ baseUrl, supabase, token }) => {
    const start = await fetch(`${baseUrl}/api/cycle-counts`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ product_ids: ['product-cycle-salmon'] }),
    });
    assert.equal(start.status, 201);
    const started = await start.json();
    assert.equal(started.status, 'open');
    assert.equal(started.items.length, 1);
    assert.equal(started.items[0].expected_qty, 10);

    const submit = await fetch(`${baseUrl}/api/cycle-counts/${started.id}/items`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ items: [{ id: started.items[0].id, counted_qty: 7, notes: 'Case short' }] }),
    });
    assert.equal(submit.status, 200);

    const commit = await fetch(`${baseUrl}/api/cycle-counts/${started.id}/commit`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    assert.equal(commit.status, 200);
    const committed = await commit.json();
    assert.equal(committed.status, 'completed');
    assert.equal(committed.items[0].variance_qty, -3);

    const { data: history } = await supabase
      .from('inventory_stock_history')
      .select('*')
      .eq('item_number', 'SAL-CYCLE')
      .eq('change_type', 'cycle_count');
    assert.equal(history.length, 1);
    assert.equal(history[0].change_qty, -3);
    assert.equal(history[0].new_qty, 7);
    assert.equal(history[0].company_id, 'company-cycle');
  });
});
