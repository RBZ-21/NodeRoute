const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}deliveries.js`)
    ) {
      delete require.cache[key];
    }
  }
}

test('delivery inventory deduction checks the ledger in one batched query, not one per item', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-delivery-ledger-batch-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const deliveriesRoute = require('../routes/deliveries');

    const context = { activeCompanyId: 'company-ledger-batch', activeLocationId: 'loc-ledger-batch' };
    await supabase.from('products').insert([
      { id: 'prod-ledger-1', item_number: 'ITEM-LB-1', name: 'A', on_hand_qty: 100, company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch' },
      { id: 'prod-ledger-2', item_number: 'ITEM-LB-2', name: 'B', on_hand_qty: 100, company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch' },
      { id: 'prod-ledger-3', item_number: 'ITEM-LB-3', name: 'C', on_hand_qty: 100, company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch' },
    ]);
    // Pre-existing ledger entry for ITEM-LB-2 only, simulating a partial prior run.
    await supabase.from('inventory_stock_history').insert({
      item_number: 'ITEM-LB-2', change_type: 'delivery_complete', notes: 'Delivery ORD-LB completed',
      company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch',
    });

    const queryLog = [];
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      if (table === 'inventory_stock_history') queryLog.push(table);
      return originalFrom(table);
    };

    try {
      const existing = await deliveriesRoute.hasDeliveryInventoryLedgerEntries(
        ['ITEM-LB-1', 'ITEM-LB-2', 'ITEM-LB-3'],
        'Delivery ORD-LB completed',
        context
      );
      assert.equal(queryLog.length, 1, `expected exactly 1 inventory_stock_history query for 3 items, got ${queryLog.length}`);
      assert.ok(existing.has('ITEM-LB-2'));
      assert.ok(!existing.has('ITEM-LB-1'));
      assert.ok(!existing.has('ITEM-LB-3'));
    } finally {
      supabase.from = originalFrom;
    }
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
