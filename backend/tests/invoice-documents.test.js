'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const COMPANY_ID = 'company-docs-a';
const LOCATION_ID = 'location-docs-a';

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}print.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}order-documents.js`)
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

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function withPrintApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-print-docs-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const router = require('../routes/print');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert({
      id: 'docs-admin',
      name: 'Docs Admin',
      email: 'docs-admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
    });
    await supabase.from('orders').insert({
      id: 'order-docs-a',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      customer_name: 'Harbor Kitchen',
      order_number: 'ORD-DOCS',
      route_id: 'route-docs-a',
      status: 'pending',
      items: [
        { product_id: 'prod-fish', item_number: 'FISH-1', name: 'Cod Fillet', quantity: 3, unit: 'case', lot_number: 'LOT-9', location: 'Cooler A', instructions: [{ instruction_type: 'cutting', instruction: '2 lb portions' }] },
        { product_id: 'prod-shell', item_number: 'SHELL-1', name: 'Oysters', quantity: 1, unit: 'bag', lot_number: 'LOT-10', location: 'Cooler B' },
      ],
    });
    await supabase.from('routes').insert({
      id: 'route-docs-a',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      name: 'North Route',
      stop_ids: ['stop-docs-a'],
      active_stop_ids: ['stop-docs-a'],
    });
    await supabase.from('stops').insert({
      id: 'stop-docs-a',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      route_id: 'route-docs-a',
      customer_name: 'Harbor Kitchen',
      address: '100 Harbor Way',
      sequence: 1,
      order_id: 'order-docs-a',
    });

    const app = express();
    app.use('/api/print', router);
    server = await listen(app);

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokenFor = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '1h' });
    await fn({ baseUrl, tokenFor });
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

async function fetchPdf(baseUrl, token, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: authHeaders(token),
  });
  const text = Buffer.from(await response.arrayBuffer()).toString('latin1');
  return { response, text };
}

test('print document variants return PDFs with expected section headers', async () => {
  await withPrintApp(async ({ baseUrl, tokenFor }) => {
    const token = tokenFor('docs-admin');
    const variants = [
      ['/api/print/loading-sheet/route-docs-a', 'LOADING SHEET'],
      ['/api/print/cut-list/order-docs-a', 'CUT LIST'],
      ['/api/print/pick-list/order-docs-a', 'PICK LIST'],
      ['/api/print/pull-sheet/route-docs-a', 'PULL SHEET'],
      ['/api/print/picking-labels/order-docs-a', 'PICKING LABELS'],
    ];

    for (const [pathName, expectedHeader] of variants) {
      const { response, text } = await fetchPdf(baseUrl, token, pathName);
      assert.equal(response.status, 200, `${pathName} status`);
      assert.match(response.headers.get('content-type') || '', /application\/pdf/, `${pathName} content type`);
      assert.match(text, new RegExp(expectedHeader), `${pathName} header`);
    }
  });
});
