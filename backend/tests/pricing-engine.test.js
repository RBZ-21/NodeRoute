'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COMPANY_ID = 'company-pricing-a';
const LOCATION_ID = 'location-pricing-a';
const CUSTOMER_ID = 'customer-pricing-a';
const TEST_DATE = '2026-06-15';

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}pricing-engine.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function pricingContext() {
  return {
    companyId: COMPANY_ID,
    activeCompanyId: COMPANY_ID,
    accessibleCompanyIds: [COMPANY_ID],
    locationId: LOCATION_ID,
    activeLocationId: LOCATION_ID,
    accessibleLocationIds: [LOCATION_ID],
    isGlobalOperator: false,
  };
}

async function withPricingEngine(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-pricing-engine-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const engine = require('../services/pricing-engine');
    await fn({ supabase, engine, context: pricingContext() });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

function product(id, price = 20) {
  return {
    id,
    company_id: COMPANY_ID,
    location_id: LOCATION_ID,
    item_number: id.toUpperCase(),
    description: `Product ${id}`,
    category_id: 'cat-seafood',
    category: 'Seafood',
    cost: 10,
    real_cost: 10,
    price_per_unit: price,
  };
}

async function seedBaseRows(supabase) {
  await supabase.from('products').insert([
    product('p-quote'),
    product('p-special'),
    product('p-promo'),
    product('p-level'),
    product('p-list'),
    product('p-expired'),
    product('p-min'),
  ]);

  await supabase.from('price_levels').insert({
    id: 'level-a',
    company_id: COMPANY_ID,
    name: 'Wholesale A',
  });
  await supabase.from('customer_price_level_assignments').insert({
    id: 'assignment-a',
    company_id: COMPANY_ID,
    customer_id: CUSTOMER_ID,
    price_level_id: 'level-a',
    effective_date: '2026-06-01',
    expiry_date: null,
  });
  await supabase.from('price_level_rules').insert([
    { id: 'rule-quote', company_id: COMPANY_ID, price_level_id: 'level-a', product_id: 'p-quote', method: 'fixed_dollar', value: 17 },
    { id: 'rule-special', company_id: COMPANY_ID, price_level_id: 'level-a', product_id: 'p-special', method: 'fixed_dollar', value: 17 },
    { id: 'rule-promo', company_id: COMPANY_ID, price_level_id: 'level-a', product_id: 'p-promo', method: 'fixed_dollar', value: 17 },
    { id: 'rule-level', company_id: COMPANY_ID, price_level_id: 'level-a', product_id: 'p-level', method: 'fixed_dollar', value: 17 },
    { id: 'rule-expired', company_id: COMPANY_ID, price_level_id: 'level-a', product_id: 'p-expired', method: 'fixed_dollar', value: 18 },
  ]);

  await supabase.from('customer_special_prices').insert([
    { id: 'special-quote', company_id: COMPANY_ID, customer_id: CUSTOMER_ID, product_id: 'p-quote', special_price: 15, effective_date: '2026-06-01', expiry_date: null },
    { id: 'special-active', company_id: COMPANY_ID, customer_id: CUSTOMER_ID, product_id: 'p-special', special_price: 15, effective_date: '2026-06-01', expiry_date: null },
    { id: 'special-expired', company_id: COMPANY_ID, customer_id: CUSTOMER_ID, product_id: 'p-expired', special_price: 6, effective_date: '2026-01-01', expiry_date: '2026-01-31' },
  ]);

  await supabase.from('promotions').insert([
    { id: 'promo-quote', company_id: COMPANY_ID, name: 'Quote Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-06-01', end_date: '2026-06-30' },
    { id: 'promo-special', company_id: COMPANY_ID, name: 'Special Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-06-01', end_date: '2026-06-30' },
    { id: 'promo-active', company_id: COMPANY_ID, name: 'Active Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-06-01', end_date: '2026-06-30' },
    { id: 'promo-expired', company_id: COMPANY_ID, name: 'Expired Promo', promo_type: 'sale_price', status: 'active', start_date: '2026-01-01', end_date: '2026-01-31' },
  ]);
  await supabase.from('promotion_items').insert([
    { id: 'promo-item-quote', company_id: COMPANY_ID, promotion_id: 'promo-quote', product_id: 'p-quote', value: 13 },
    { id: 'promo-item-special', company_id: COMPANY_ID, promotion_id: 'promo-special', product_id: 'p-special', value: 13 },
    { id: 'promo-item-active', company_id: COMPANY_ID, promotion_id: 'promo-active', product_id: 'p-promo', value: 13 },
    { id: 'promo-item-expired', company_id: COMPANY_ID, promotion_id: 'promo-expired', product_id: 'p-expired', value: 5 },
  ]);

  await supabase.from('quotes').insert([
    { id: 'quote-active', company_id: COMPANY_ID, customer_id: CUSTOMER_ID, status: 'active', valid_from: '2026-06-01', valid_until: '2026-06-30' },
    { id: 'quote-expired', company_id: COMPANY_ID, customer_id: CUSTOMER_ID, status: 'active', valid_from: '2026-01-01', valid_until: '2026-01-31' },
  ]);
  await supabase.from('quote_items').insert([
    { id: 'quote-item-active', company_id: COMPANY_ID, quote_id: 'quote-active', product_id: 'p-quote', quoted_price: 12, min_qty: 1, uom: 'case' },
    { id: 'quote-item-expired', company_id: COMPANY_ID, quote_id: 'quote-expired', product_id: 'p-expired', quoted_price: 4, min_qty: 1, uom: 'case' },
  ]);
}

test('pricing engine resolves prices by deterministic precedence', async () => {
  await withPricingEngine(async ({ supabase, engine, context }) => {
    await seedBaseRows(supabase);

    const cases = [
      ['p-quote', 12, 'quote'],
      ['p-special', 15, 'customer_special'],
      ['p-promo', 13, 'promotion'],
      ['p-level', 17, 'price_level'],
      ['p-list', 20, 'list'],
    ];

    for (const [productId, expectedPrice, expectedMethod] of cases) {
      const result = await engine.resolvePrice({
        db: supabase,
        customerId: CUSTOMER_ID,
        productId,
        qty: 1,
        uom: 'case',
        context,
        onDate: TEST_DATE,
      });
      assert.equal(result.price, expectedPrice, `${productId} price`);
      assert.equal(result.method, expectedMethod, `${productId} method`);
      assert.ok(result.source_id || expectedMethod === 'list');
    }
  });
});

test('pricing engine ignores expired overrides before falling back to active lower precedence rules', async () => {
  await withPricingEngine(async ({ supabase, engine, context }) => {
    await seedBaseRows(supabase);

    const result = await engine.resolvePrice({
      db: supabase,
      customerId: CUSTOMER_ID,
      productId: 'p-expired',
      qty: 1,
      uom: 'case',
      context,
      onDate: TEST_DATE,
    });

    assert.equal(result.price, 18);
    assert.equal(result.method, 'price_level');
  });
});

test('minimum sell enforcement uses the higher explicit min price or margin price', async () => {
  await withPricingEngine(async ({ supabase, engine, context }) => {
    await seedBaseRows(supabase);
    await supabase.from('minimum_sell_rules').insert({
      id: 'min-rule-p',
      company_id: COMPANY_ID,
      product_id: 'p-min',
      category_id: null,
      min_margin_pct: 25,
      min_price: 14,
    });

    const blocked = await engine.enforceMinimumSell({
      db: supabase,
      price: 13,
      productId: 'p-min',
      companyId: COMPANY_ID,
      context,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.min_price, 14);

    const allowed = await engine.enforceMinimumSell({
      db: supabase,
      price: 15,
      productId: 'p-min',
      companyId: COMPANY_ID,
      context,
    });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.min_price, 14);
  });
});
