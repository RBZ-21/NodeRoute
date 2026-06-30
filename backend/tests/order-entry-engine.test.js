'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COMPANY_ID = 'company-order-entry-a';
const LOCATION_ID = 'location-order-entry-a';
const CUSTOMER_ID = 'customer-order-entry-a';

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}pricing-engine.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}order-entry-engine.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function context() {
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

async function withOrderEntryEngine(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-order-entry-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const engine = require('../services/order-entry-engine');
    await fn({ supabase, engine, context: context() });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

async function seedProducts(supabase) {
  await supabase.from('products').insert([
    {
      id: 'prod-original',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      item_number: 'ORIG',
      barcode: '000111222333',
      description: 'Original Fish',
      price_per_unit: 20,
      cost: 10,
      on_hand_qty: 0,
      is_catch_weight: true,
      estimated_unit_weight: 1.5,
    },
    {
      id: 'prod-sub',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      item_number: 'SUB',
      barcode: '999888777666',
      description: 'Substitute Fish',
      price_per_unit: 18,
      cost: 9,
      on_hand_qty: 25,
    },
    {
      id: 'prod-deposit',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      item_number: 'BOTTLE',
      barcode: 'BOTTLE1',
      description: 'Sparkling Water',
      price_per_unit: 4,
      cost: 2,
      on_hand_qty: 20,
    },
    {
      id: 'prod-short',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      item_number: 'SHORT',
      description: 'Short Product',
      price_per_unit: 7,
      cost: 3,
      on_hand_qty: 1,
    },
  ]);
}

test('resolveOrderLine applies substitution, pricing, deposit, messages, instructions, and catch weight metadata', async () => {
  await withOrderEntryEngine(async ({ supabase, engine, context }) => {
    await seedProducts(supabase);
    await supabase.from('customer_substitutions').insert({
      id: 'sub-a',
      company_id: COMPANY_ID,
      customer_id: CUSTOMER_ID,
      original_product_id: 'prod-original',
      substitute_product_id: 'prod-sub',
      priority: 1,
      is_active: true,
    });
    await supabase.from('bottle_deposits').insert({
      id: 'deposit-a',
      company_id: COMPANY_ID,
      product_id: 'prod-sub',
      deposit_amount: 0.1,
      deposit_uom: 'each',
      is_active: true,
    });
    await supabase.from('customer_hot_messages').insert({
      id: 'message-a',
      company_id: COMPANY_ID,
      customer_id: CUSTOMER_ID,
      message: 'COD only',
      message_type: 'order_entry',
      start_date: '2026-06-01',
      end_date: '2026-06-30',
    });
    await supabase.from('customer_item_instructions').insert({
      id: 'instruction-a',
      company_id: COMPANY_ID,
      customer_id: CUSTOMER_ID,
      product_id: 'prod-sub',
      instruction: 'Cut thick portions',
      instruction_type: 'cutting',
    });

    const resolved = await engine.resolveOrderLine({
      db: supabase,
      customerId: CUSTOMER_ID,
      productId: 'prod-original',
      qty: 3,
      uom: 'each',
      context,
      onDate: '2026-06-15',
    });

    assert.equal(resolved.product_id, 'prod-sub');
    assert.equal(resolved.substitution.original_product_id, 'prod-original');
    assert.equal(resolved.price.method, 'list');
    assert.equal(resolved.unit_price, 18);
    assert.equal(resolved.is_catch_weight, false);
    assert.equal(resolved.deposit_lines.length, 1);
    assert.equal(resolved.deposit_lines[0].name, 'Bottle deposit');
    assert.equal(resolved.deposit_lines[0].unit_price, 0.1);
    assert.deepEqual(resolved.hot_messages.map((message) => message.message), ['COD only']);
    assert.deepEqual(resolved.instructions.map((instruction) => instruction.instruction), ['Cut thick portions']);
  });
});

test('fuel surcharge, backorder split, minimum sell delegation, and barcode scans use tenant-scoped order state', async () => {
  await withOrderEntryEngine(async ({ supabase, engine, context }) => {
    await seedProducts(supabase);
    await supabase.from('fuel_surcharge_rules').insert({
      id: 'fuel-a',
      company_id: COMPANY_ID,
      name: 'Fuel 5%',
      method: 'percent_of_order',
      value: 5,
      min_order_value: 10,
      effective_date: '2026-06-01',
      expiry_date: null,
    });
    await supabase.from('minimum_sell_rules').insert({
      id: 'min-a',
      company_id: COMPANY_ID,
      product_id: 'prod-sub',
      min_margin_pct: null,
      min_price: 12,
    });
    await supabase.from('orders').insert({
      id: 'order-entry-a',
      company_id: COMPANY_ID,
      location_id: LOCATION_ID,
      customer_id: CUSTOMER_ID,
      customer_name: 'Order Entry Customer',
      order_number: 'ORD-ENTRY',
      status: 'pending',
      items: [
        { product_id: 'prod-sub', item_number: 'SUB', name: 'Substitute Fish', quantity: 2, unit_price: 18 },
        { product_id: 'prod-short', item_number: 'SHORT', name: 'Short Product', quantity: 4, unit_price: 7 },
      ],
      total: 64,
      subtotal: 64,
    });

    const min = await engine.validateMinimumSell({
      db: supabase,
      productId: 'prod-sub',
      price: 11,
      context,
    });
    assert.equal(min.allowed, false);
    assert.equal(min.min_price, 12);

    const fuel = await engine.applyFuelSurcharge({
      db: supabase,
      orderId: 'order-entry-a',
      context,
      onDate: '2026-06-15',
    });
    assert.equal(fuel.surcharge_line.name, 'Fuel surcharge');
    assert.equal(fuel.surcharge_line.total, 3.2);

    const backorder = await engine.processBackorder({
      db: supabase,
      orderId: 'order-entry-a',
      context,
    });
    assert.equal(backorder.backorder.items.length, 1);
    assert.equal(backorder.backorder.items[0].product_id, 'prod-short');
    assert.equal(backorder.updated_order.items.filter((item) => item.product_id).length, 1);

    const firstScan = await engine.applyBarcodeScan({
      db: supabase,
      orderId: 'order-entry-a',
      barcode: '999888777666',
      userId: 'scanner-a',
      context,
    });
    const secondScan = await engine.applyBarcodeScan({
      db: supabase,
      orderId: 'order-entry-a',
      barcode: '999888777666',
      userId: 'scanner-a',
      context,
    });
    assert.equal(firstScan.action, 'incremented');
    assert.equal(secondScan.action, 'duplicate');
    assert.equal(secondScan.order.items.filter((item) => item.product_id === 'prod-sub').length, 1);
  });
});
