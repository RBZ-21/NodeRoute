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
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}kits.js`) ||
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

async function withKitsApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-kits-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const kitsRouter = require('../routes/kits');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([{
      id: 'kits-admin',
      name: 'Kits Admin',
      email: 'kits-admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-kits',
      location_id: 'location-kits',
    }]);
    await supabase.from('products').insert([
      {
        id: 'product-shellfish',
        item_number: 'SHELL-KIT',
        description: 'Shellfish Input',
        name: 'Shellfish Input',
        unit: 'lb',
        on_hand_qty: 10,
        lot_item: 'Y',
        company_id: 'company-kits',
        location_id: 'location-kits',
      },
      {
        id: 'product-kit-output',
        item_number: 'KIT-BOX',
        description: 'Seafood Kit Box',
        name: 'Seafood Kit Box',
        unit: 'each',
        on_hand_qty: 1,
        company_id: 'company-kits',
        location_id: 'location-kits',
      },
    ]);
    await supabase.from('inventory_lots').insert([{
      id: 'lot-shellfish',
      item_number: 'SHELL-KIT',
      lot_number: 'LOT-KIT',
      qty_received: 10,
      qty_on_hand: 10,
      status: 'active',
      company_id: 'company-kits',
      location_id: 'location-kits',
    }]);
    await supabase.from('inventory_uom_conversions').insert([{
      id: 'conversion-kit',
      product_id: 'product-shellfish',
      from_uom: 'lb',
      to_uom: 'lb',
      factor: 1,
      company_id: 'company-kits',
      location_id: 'location-kits',
    }]);

    const app = express();
    app.use(express.json());
    app.use('/api/kits', kitsRouter);
    server = await listen(app);

    await fn({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      supabase,
      token: jwt.sign({ userId: 'kits-admin' }, jwtSecret, { expiresIn: '1h' }),
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

async function createRecipe(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/kits/recipes`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: 'Shellfish Kit',
      output_product_id: 'product-kit-output',
      output_qty: 1,
      output_uom: 'each',
      items: [{
        input_product_id: 'product-shellfish',
        input_lot_id: 'lot-shellfish',
        input_qty: 4,
        input_uom: 'lb',
      }],
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test('kit processing rejects insufficient input stock', async () => {
  await withKitsApp(async ({ baseUrl, token }) => {
    const recipe = await createRecipe(baseUrl, token);

    const response = await fetch(`${baseUrl}/api/kits/process`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ kit_recipe_id: recipe.id, quantity_produced: 3 }),
    });

    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /insufficient/i);
  });
});

test('successful kit run debits inputs and credits output with one ledger group', async () => {
  await withKitsApp(async ({ baseUrl, supabase, token }) => {
    const recipe = await createRecipe(baseUrl, token);

    const response = await fetch(`${baseUrl}/api/kits/process`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ kit_recipe_id: recipe.id, quantity_produced: 2 }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.ok(body.ledger_group_id);

    const { data: products } = await supabase.from('products').select('*');
    assert.equal(products.find((p) => p.item_number === 'SHELL-KIT').on_hand_qty, 2);
    assert.equal(products.find((p) => p.item_number === 'KIT-BOX').on_hand_qty, 3);

    const { data: history } = await supabase
      .from('inventory_stock_history')
      .select('*')
      .eq('ledger_ref', body.ledger_group_id);
    assert.deepEqual(history.map((row) => row.change_type).sort(), ['kit_input', 'kit_output']);
  });
});

test('kit processing compensates debits when output credit fails', async () => {
  await withKitsApp(async ({ baseUrl, supabase, token }) => {
    const recipe = await createRecipe(baseUrl, token);

    const response = await fetch(`${baseUrl}/api/kits/process`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        kit_recipe_id: recipe.id,
        quantity_produced: 1,
        simulate_failure_after_debits: true,
      }),
    });

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.ok(body.ledger_group_id);

    const { data: products } = await supabase.from('products').select('*');
    assert.equal(products.find((p) => p.item_number === 'SHELL-KIT').on_hand_qty, 10);
    assert.equal(products.find((p) => p.item_number === 'KIT-BOX').on_hand_qty, 1);

    const { data: runs } = await supabase
      .from('kit_processing_runs')
      .select('*')
      .eq('ledger_group_id', body.ledger_group_id);
    assert.equal(runs[0].status, 'failed');
  });
});
