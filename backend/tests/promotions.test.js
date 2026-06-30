'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const COMPANY_ID = 'company-promo-a';
const LOCATION_ID = 'location-promo-a';

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}promotions.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}pricing-engine.js`)
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
    'Content-Type': 'application/json',
  };
}

async function withPromotionsApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-promotions-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const promotionsRouter = require('../routes/promotions');
    const engine = require('../services/pricing-engine');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert({
      id: 'promo-admin',
      name: 'Promo Admin',
      email: 'promo-admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
    });

    const app = express();
    app.use(express.json());
    app.use('/api/promotions', promotionsRouter);
    server = await listen(app);

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokenFor = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '1h' });
    await fn({ baseUrl, supabase, engine, tokenFor });
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

test('active promotions endpoint excludes expired promotions for the requested date', async () => {
  await withPromotionsApp(async ({ baseUrl, supabase, tokenFor }) => {
    await supabase.from('promotions').insert([
      { id: 'promo-current', company_id: COMPANY_ID, name: 'Current Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-06-01', end_date: '2026-06-30' },
      { id: 'promo-old', company_id: COMPANY_ID, name: 'Old Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-01-01', end_date: '2026-01-31' },
    ]);

    const response = await fetch(`${baseUrl}/api/promotions/active?date=2026-06-15`, {
      headers: authHeaders(tokenFor('promo-admin')),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.promotions.map((promo) => promo.id), ['promo-current']);
  });
});

test('pricing engine chooses the lowest active overlapping promotion price', async () => {
  await withPromotionsApp(async ({ supabase, engine }) => {
    const context = {
      companyId: COMPANY_ID,
      activeCompanyId: COMPANY_ID,
      accessibleCompanyIds: [COMPANY_ID],
      locationId: LOCATION_ID,
      activeLocationId: LOCATION_ID,
      accessibleLocationIds: [LOCATION_ID],
      isGlobalOperator: false,
    };

    await supabase.from('products').insert({
      id: 'promo-product',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      description: 'Promo Product',
      item_number: 'PROMO-1',
      category: 'Seafood',
      category_id: 'cat-seafood',
      cost: 10,
      price_per_unit: 25,
    });
    await supabase.from('promotions').insert([
      { id: 'promo-high', company_id: COMPANY_ID, name: 'High Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-06-01', end_date: '2026-06-30' },
      { id: 'promo-low', company_id: COMPANY_ID, name: 'Low Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-06-01', end_date: '2026-06-30' },
      { id: 'promo-expired', company_id: COMPANY_ID, name: 'Expired Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-01-01', end_date: '2026-01-31' },
    ]);
    await supabase.from('promotion_items').insert([
      { id: 'promo-high-item', company_id: COMPANY_ID, promotion_id: 'promo-high', product_id: 'promo-product', value: 18 },
      { id: 'promo-low-item', company_id: COMPANY_ID, promotion_id: 'promo-low', product_id: 'promo-product', value: 16.25 },
      { id: 'promo-expired-item', company_id: COMPANY_ID, promotion_id: 'promo-expired', product_id: 'promo-product', value: 2 },
    ]);

    const result = await engine.resolvePrice({
      db: supabase,
      customerId: 'promo-customer',
      productId: 'promo-product',
      qty: 1,
      uom: 'case',
      context,
      onDate: '2026-06-15',
    });

    assert.equal(result.method, 'promotion');
    assert.equal(result.price, 16.25);
    assert.equal(result.source_id, 'promo-low-item');
  });
});
