const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

function freshOrdersHelpers() {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-orders-'));
  const prevBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const prevForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';

  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}services${path.sep}supabase.js`)
      || key.includes(`${path.sep}routes${path.sep}orders.js`)
    ) {
      delete require.cache[key];
    }
  }

  const orders = require('../routes/orders');
  const { supabase } = require('../services/supabase');

  return {
    supabase,
    validateFtlLots: orders.validateFtlLots,
    enrichItemsWithLotData: orders.enrichItemsWithLotData,
    findInventoryMatchForFulfillment: orders.findInventoryMatchForFulfillment,
    cleanup() {
      if (prevBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
      else process.env.NODEROUTE_BACKUP_PATH = prevBackupPath;
      if (prevForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
      else process.env.NODEROUTE_FORCE_DEMO_MODE = prevForceDemoMode;
      for (const key of Object.keys(require.cache)) {
        if (
          key.includes(`${path.sep}services${path.sep}supabase.js`)
          || key.includes(`${path.sep}routes${path.sep}orders.js`)
        ) {
          delete require.cache[key];
        }
      }
      fs.rmSync(backupPath, { recursive: true, force: true });
    },
  };
}

test('order lot helpers accept UUID lot ids without integer coercion', async () => {
  const { supabase, validateFtlLots, enrichItemsWithLotData, cleanup } = freshOrdersHelpers();

  try {
    await supabase.from('seafood_inventory').insert({
      id: 'prod-1',
      item_number: 'SAL-01',
      description: 'Atlantic Salmon',
      is_ftl_product: true,
    });
    await supabase.from('lot_codes').insert({
      id: '11111111-1111-4111-8111-111111111111',
      lot_number: 'LOT-SAL-1',
      product_id: 'SAL-01',
      expiration_date: '2099-01-01',
    });

    const items = [{ item_number: 'SAL-01', lot_id: '11111111-1111-4111-8111-111111111111', quantity: 2 }];
    assert.equal(await validateFtlLots(items), null);

    const enriched = await enrichItemsWithLotData(items);
    assert.equal(enriched[0].lot_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(enriched[0].lot_number, 'LOT-SAL-1');
    assert.equal(enriched[0].quantity_from_lot, 2);
  } finally {
    cleanup();
  }
});

test('order lot helpers normalize numeric lot ids consistently', async () => {
  const { supabase, validateFtlLots, enrichItemsWithLotData, cleanup } = freshOrdersHelpers();

  try {
    await supabase.from('seafood_inventory').insert({
      id: 'prod-2',
      item_number: 'COD-01',
      description: 'Black Cod',
      is_ftl_product: true,
    });
    await supabase.from('lot_codes').insert({
      id: 42,
      lot_number: 'LOT-COD-42',
      product_id: 'COD-01',
      expiration_date: '2099-02-01',
    });

    const items = [{ item_number: 'COD-01', lot_id: '42', quantity: 3 }];
    assert.equal(await validateFtlLots(items), null);

    const enriched = await enrichItemsWithLotData(items);
    assert.equal(enriched[0].lot_id, '42');
    assert.equal(enriched[0].lot_number, 'LOT-COD-42');
    assert.equal(enriched[0].quantity_from_lot, 3);
  } finally {
    cleanup();
  }
});

test('fulfillment inventory matching prefers explicit product_id', async () => {
  const { supabase, findInventoryMatchForFulfillment, cleanup } = freshOrdersHelpers();

  try {
    await supabase.from('seafood_inventory').insert({
      id: 'prod-1',
      item_number: 'SAL-01',
      description: 'Atlantic Salmon',
      on_hand_qty: 12,
      cost: 14.5,
    });

    const match = await findInventoryMatchForFulfillment({
      product_id: 'prod-1',
      item_number: 'WRONG-SKU',
      name: 'Wrong Product Name',
      description: 'Wrong Product Description',
    });

    assert.equal(match?.id, 'prod-1');
    assert.equal(match?.item_number, 'SAL-01');
    assert.equal(match?.description, 'Atlantic Salmon');
  } finally {
    cleanup();
  }
});
