const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-dev-secret';

function freshCatchWeightHelpers() {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-cw-'));
  const prevBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const prevForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';

  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}services${path.sep}supabase.js`)
      || key.includes(`${path.sep}routes${path.sep}catch-weight.js`)
    ) {
      delete require.cache[key];
    }
  }

  const catchWeight = require('../routes/catch-weight');
  const { supabase } = require('../services/supabase');

  return {
    supabase,
    createCatchWeightEntry: catchWeight.createCatchWeightEntry,
    cleanup() {
      if (prevBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
      else process.env.NODEROUTE_BACKUP_PATH = prevBackupPath;
      if (prevForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
      else process.env.NODEROUTE_FORCE_DEMO_MODE = prevForceDemoMode;
      for (const key of Object.keys(require.cache)) {
        if (
          key.includes(`${path.sep}services${path.sep}supabase.js`)
          || key.includes(`${path.sep}routes${path.sep}catch-weight.js`)
        ) {
          delete require.cache[key];
        }
      }
      fs.rmSync(backupPath, { recursive: true, force: true });
    },
  };
}

test('catch weight entry records actual weight and updates JSON order item status', async () => {
  const { supabase, createCatchWeightEntry, cleanup } = freshCatchWeightHelpers();
  try {
    const productId = '11111111-1111-4111-8111-111111111111';
    const orderId = '22222222-2222-4222-8222-222222222222';
    await supabase.from('products').insert({
      id: productId,
      item_number: 'SAL-01',
      name: 'Atlantic Salmon',
      is_catch_weight: true,
      estimated_unit_weight: 23.5,
      weight_tolerance_pct: 10,
      catch_weight_unit: 'lb',
      company_id: '00000000-0000-0000-0000-000000000001',
    });
    await supabase.from('orders').insert({
      id: orderId,
      order_number: 'ORD-CW',
      customer_name: 'Seafood Market',
      items: [{
        product_id: productId,
        item_number: 'SAL-01',
        name: 'Atlantic Salmon',
        is_catch_weight: true,
        quantity: 3,
        unit: 'case',
        price_per_lb: 4.5,
      }],
      company_id: '00000000-0000-0000-0000-000000000001',
    });

    const entry = await createCatchWeightEntry({
      order_item_id: `${orderId}:0`,
      actual_weight: 71.3,
      weight_unit: 'lb',
      price_per_weight_unit: 4.5,
      weighed_by: 'admin-001',
    }, {
      user: { id: 'admin-001' },
      context: { companyId: '00000000-0000-0000-0000-000000000001' },
    });

    assert.equal(entry.weight_status, 'weighed');
    assert.equal(entry.estimated_weight, 70.5);
    assert.equal(entry.total_price, 320.85);

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    assert.equal(order.items[0].actual_weight, 71.3);
    assert.equal(order.items[0].weight_status, 'weighed');
  } finally {
    cleanup();
  }
});

test('catch weight entry flags variance beyond product tolerance without blocking save', async () => {
  const { supabase, createCatchWeightEntry, cleanup } = freshCatchWeightHelpers();
  try {
    const productId = '33333333-3333-4333-8333-333333333333';
    const orderId = '44444444-4444-4444-8444-444444444444';
    await supabase.from('products').insert({
      id: productId,
      item_number: 'HAL-01',
      name: 'Halibut',
      is_catch_weight: true,
      estimated_unit_weight: 10,
      weight_tolerance_pct: 5,
      company_id: '00000000-0000-0000-0000-000000000001',
    });
    await supabase.from('orders').insert({
      id: orderId,
      order_number: 'ORD-FLAG',
      customer_name: 'Market',
      items: [{ product_id: productId, name: 'Halibut', is_catch_weight: true, quantity: 2, unit: 'case', price_per_lb: 8 }],
      company_id: '00000000-0000-0000-0000-000000000001',
    });

    const entry = await createCatchWeightEntry({
      order_id: orderId,
      item_index: 0,
      actual_weight: 25,
      price_per_weight_unit: 8,
    }, {
      user: { id: 'admin-001' },
      context: { companyId: '00000000-0000-0000-0000-000000000001' },
    });

    assert.equal(entry.weight_status, 'variance_flagged');
    assert.equal(entry.variance_pct, 25);

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    assert.equal(order.items[0].weight_status, 'variance_flagged');
  } finally {
    cleanup();
  }
});

test('invoice catch-weight guard blocks missing weights and summarizes captured weights', () => {
  const invoices = require('../routes/invoices');
  const items = [
    { name: 'Salmon', is_catch_weight: true, estimated_weight: 20, actual_weight: 21.25, weight_status: 'weighed' },
    { name: 'Halibut', is_catch_weight: true, estimated_weight: 10, actual_weight: 9.5, weight_status: 'approved' },
  ];

  assert.equal(invoices.catchWeightInvoiceBlock(items), null);
  assert.match(
    invoices.catchWeightInvoiceBlock([{ name: 'Tuna', is_catch_weight: true, estimated_weight: 12, weight_status: 'pending' }]),
    /catch weight not recorded/i
  );

  const summary = invoices.catchWeightInvoiceSummary(items);
  assert.equal(summary.total_estimated_weight, 30);
  assert.equal(summary.total_actual_weight, 30.75);
  assert.equal(summary.total_variance_lbs, 0.75);
  assert.equal(summary.total_variance_pct, 2.5);
});
