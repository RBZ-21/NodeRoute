'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const COMPANY_ID = 'company-order-pricing-a';
const LOCATION_ID = 'location-order-pricing-a';
const PRODUCT_ID = 'order-pricing-product';
const PRODUCT_ID_2 = 'order-pricing-product-2';

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}orders.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}pricing-engine.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}order-validation.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}creditEngine.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}plan-limits.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}printer.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}reorderEngine.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function installServiceMock(relativePath, exports) {
  const servicePath = path.resolve(__dirname, relativePath);
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports,
  };
}

function installOrderSideEffectMocks() {
  installServiceMock('../services/creditEngine.js', {
    checkOrderAllowed: async () => ({ allowed: true }),
    logOrderBlocked: async () => {},
    consumeOverride: async () => {},
  });
  installServiceMock('../services/plan-limits.js', {
    enforceDeliveryLimit: async () => {},
    sendPlanLimitError: () => false,
  });
  installServiceMock('../services/printer.js', {
    triggerPrintJob: async () => ({ ok: true }),
  });
  installServiceMock('../services/reorderEngine.js', {
    runReorderCheck: async () => ({ checked: true }),
  });
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

async function seedOrderPricingData(supabase) {
  await supabase.from('users').insert([
    {
      id: 'pricing-manager',
      name: 'Pricing Manager',
      email: 'pricing-manager@noderoute.test',
      role: 'manager',
      status: 'active',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
    },
    {
      id: 'pricing-admin',
      name: 'Pricing Admin',
      email: 'pricing-admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
    },
  ]);

  await supabase.from('products').insert({
    id: PRODUCT_ID,
    company_id: COMPANY_ID,
    location_id: LOCATION_ID,
    item_number: 'MIN-SELL-1',
    description: 'Minimum Sell Product',
    category: 'Seafood',
    category_id: 'cat-seafood',
    cost: 10,
    price_per_unit: 12,
    is_catch_weight: false,
  });

  await supabase.from('products').insert({
    id: PRODUCT_ID_2,
    company_id: COMPANY_ID,
    location_id: LOCATION_ID,
    item_number: 'MIN-SELL-2',
    description: 'Second Minimum Sell Product',
    category: 'Produce',
    category_id: 'cat-produce',
    cost: 5,
    price_per_unit: 7,
    is_catch_weight: false,
  });

  await supabase.from('minimum_sell_rules').insert([
    {
      id: 'order-min-sell-rule',
      company_id: COMPANY_ID,
      product_id: PRODUCT_ID,
      category_id: null,
      min_margin_pct: 20,
      min_price: 12,
    },
    {
      id: 'order-min-sell-rule-2',
      company_id: COMPANY_ID,
      product_id: PRODUCT_ID_2,
      category_id: null,
      min_margin_pct: null,
      min_price: 6,
    },
  ]);
}

async function withOrdersApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-orders-pricing-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();
  installOrderSideEffectMocks();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await seedOrderPricingData(supabase);

    const ordersRouter = require('../routes/orders');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    const app = express();
    app.use(express.json());
    app.use('/api/orders', ordersRouter);
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

function belowMinimumOrderPayload() {
  return {
    customerName: 'Below Minimum Cafe',
    customerEmail: 'buyer@example.test',
    fulfillmentType: 'pickup',
    items: [{
      product_id: PRODUCT_ID,
      item_number: 'MIN-SELL-1',
      name: 'Minimum Sell Product',
      unit: 'each',
      quantity: 1,
      requested_qty: 1,
      unit_price: 8,
    }],
  };
}

test('orders reject minimum sell violations for managers without override permission', async () => {
  await withOrdersApp(async ({ baseUrl, supabase, tokenFor }) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: authHeaders(tokenFor('pricing-manager')),
      body: JSON.stringify(belowMinimumOrderPayload()),
    });

    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error, 'minimum_sell_violation');
    assert.equal(body.min_price, 12.5);

    const { data: orders } = await supabase.from('orders').select('*');
    assert.deepEqual(orders, []);
  });
});

test('orders allow minimum sell override for admins', async () => {
  await withOrdersApp(async ({ baseUrl, supabase, tokenFor }) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: authHeaders(tokenFor('pricing-admin')),
      body: JSON.stringify(belowMinimumOrderPayload()),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.customer_name, 'Below Minimum Cafe');

    const { data: orders } = await supabase.from('orders').select('*');
    assert.equal(orders.length, 1);
    assert.equal(orders[0].items[0].unit_price, 8);
  });
});

test('multi-item orders validate minimum sell with a batched query instead of one per item', async () => {
  await withOrdersApp(async ({ baseUrl, supabase, tokenFor }) => {
    const queryLog = [];
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      if (table === 'minimum_sell_rules') queryLog.push(table);
      return originalFrom(table);
    };

    let response;
    try {
      response = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: authHeaders(tokenFor('pricing-admin')),
        body: JSON.stringify({
          customerName: 'Multi Item Cafe',
          customerEmail: 'buyer2@example.test',
          fulfillmentType: 'pickup',
          items: [
            {
              product_id: PRODUCT_ID,
              item_number: 'MIN-SELL-1',
              name: 'Minimum Sell Product',
              unit: 'each',
              quantity: 1,
              requested_qty: 1,
              unit_price: 13,
            },
            {
              product_id: PRODUCT_ID_2,
              item_number: 'MIN-SELL-2',
              name: 'Second Minimum Sell Product',
              unit: 'each',
              quantity: 1,
              requested_qty: 1,
              unit_price: 7,
            },
          ],
        }),
      });
    } finally {
      supabase.from = originalFrom;
    }

    assert.equal(response.status, 200);

    // minimum_sell_rules is only ever queried by minimum-sell validation, so
    // this directly measures whether the route batches across items: with
    // the old per-item loop this would be 2 (one per line item).
    const ruleQueries = queryLog.filter((t) => t === 'minimum_sell_rules').length;
    assert.equal(ruleQueries, 1, `expected exactly 1 minimum_sell_rules query for a 2-item order, got ${ruleQueries}`);
  });
});
