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
