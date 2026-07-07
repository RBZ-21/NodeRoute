// BE-001 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: inventory stock/lot quantities were updated via a JS-computed
// absolute value with no transaction/lock/CAS — concurrent movements could
// lose updates, drive stock negative, and desync products from
// inventory_stock_history. The fix routes mutations through atomic Postgres
// RPCs (apply_inventory_ledger_entry / deplete_lots_fefo) whenever reachable.

const fs = require('fs');
const path = require('path');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot, 'supabase', 'migrations', '20260705100000_atomic_inventory_ledger.sql'
);

test('atomic inventory migration exists with row locks and same-txn history insert', () => {
  assert.ok(fs.existsSync(migrationPath), 'atomic inventory ledger migration missing');
  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

  assert.ok(sql.includes('create or replace function apply_inventory_ledger_entry'));
  assert.ok(sql.includes('create or replace function deplete_lots_fefo'));
  // Row-level lock before mutation — the core of the concurrency fix.
  assert.ok(sql.includes('for update'), 'migration must lock rows with FOR UPDATE');
  // Ledger + stock history in the same function (= same transaction).
  assert.ok(
    sql.includes('insert into inventory_stock_history'),
    'history insert must live inside the atomic function'
  );
  // Negative-stock guard stays DB-side.
  assert.ok(sql.includes('ledger_negative_stock'), 'negative stock guard missing');
  // Execution locked to the backend service role.
  assert.ok(sql.includes('to service_role'), 'RPCs must be granted to service_role only');
});

test('inventory-ledger service prefers the atomic RPC over read-modify-write', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'backend', 'services', 'inventory-ledger.js'), 'utf8'
  );
  assert.ok(source.includes("supabase.rpc('apply_inventory_ledger_entry'"));
  const lotSource = fs.readFileSync(
    path.join(repoRoot, 'backend', 'services', 'lot-depletion.js'), 'utf8'
  );
  assert.ok(lotSource.includes("supabase.rpc('deplete_lots_fefo'"));
});

function withFreshLedgerModules(fn) {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-atomic-ledger-'));
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  process.env.NODEROUTE_BACKUP_PATH = backupRoot;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';

  const clearCache = () => {
    for (const key of Object.keys(require.cache)) {
      if (
        key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
        key.includes(`${path.sep}backend${path.sep}services${path.sep}inventory-ledger.js`)
      ) {
        delete require.cache[key];
      }
    }
  };
  clearCache();

  const restore = () => {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearCache();
    fs.rmSync(backupRoot, { recursive: true, force: true });
  };

  return fn().finally(restore);
}

test('applyInventoryLedgerEntry uses RPC result and never reads-then-writes when RPC succeeds', () =>
  withFreshLedgerModules(async () => {
    const { supabase } = require(path.join(repoRoot, 'backend', 'services', 'supabase.js'));
    const { applyInventoryLedgerEntry } = require(
      path.join(repoRoot, 'backend', 'services', 'inventory-ledger.js')
    );

    let rpcArgs = null;
    const originalRpc = supabase.rpc;
    const originalFrom = supabase.from;
    supabase.rpc = async (funcName, args) => {
      rpcArgs = { funcName, args };
      return {
        data: {
          ok: true,
          item_before: { item_number: 'ATOMIC-1', on_hand_qty: 10 },
          item_after: { item_number: 'ATOMIC-1', on_hand_qty: 7 },
          entry: { item_number: 'ATOMIC-1', change_qty: -3, new_qty: 7 },
          qty_before: 10,
          qty_after: 7,
          cost_before: 2,
          cost_after: 2,
        },
        error: null,
      };
    };
    // If the legacy non-atomic path runs despite a working RPC, that is a
    // regression back to the original BE-001 bug — fail loudly.
    supabase.from = () => {
      throw new Error('non-atomic read-modify-write path used despite atomic RPC being available');
    };

    try {
      const result = await applyInventoryLedgerEntry({
        itemNumber: 'ATOMIC-1',
        deltaQty: -3,
        changeType: 'pick',
        context: { companyId: 'c0mpany', activeCompanyId: 'c0mpany' },
      });
      assert.equal(rpcArgs.funcName, 'apply_inventory_ledger_entry');
      assert.equal(rpcArgs.args.p_item_number, 'ATOMIC-1');
      assert.equal(rpcArgs.args.p_delta_qty, -3);
      assert.equal(rpcArgs.args.p_prevent_negative, true);
      assert.equal(result.qty_before, 10);
      assert.equal(result.qty_after, 7);
      assert.equal(result.item_after.on_hand_qty, 7);
    } finally {
      supabase.rpc = originalRpc;
      supabase.from = originalFrom;
    }
  }));

test('applyInventoryLedgerEntry surfaces DB-side negative-stock rejection', () =>
  withFreshLedgerModules(async () => {
    const { supabase } = require(path.join(repoRoot, 'backend', 'services', 'supabase.js'));
    const { applyInventoryLedgerEntry } = require(
      path.join(repoRoot, 'backend', 'services', 'inventory-ledger.js')
    );

    const originalRpc = supabase.rpc;
    supabase.rpc = async () => ({
      data: { ok: false, code: 'LEDGER_NEGATIVE_STOCK', item_number: 'ATOMIC-2', on_hand_qty: 1, requested_delta: -5 },
      error: null,
    });

    try {
      await assert.rejects(
        applyInventoryLedgerEntry({ itemNumber: 'ATOMIC-2', deltaQty: -5, changeType: 'pick' }),
        (err) => {
          assert.equal(err.code, 'LEDGER_NEGATIVE_STOCK');
          assert.equal(err.on_hand_qty, 1);
          assert.equal(err.requested_delta, -5);
          return true;
        }
      );
    } finally {
      supabase.rpc = originalRpc;
    }
  }));

test('applyInventoryLedgerEntry falls back to legacy path when RPC is unavailable', () =>
  withFreshLedgerModules(async () => {
    const { supabase } = require(path.join(repoRoot, 'backend', 'services', 'supabase.js'));
    const { applyInventoryLedgerEntry } = require(
      path.join(repoRoot, 'backend', 'services', 'inventory-ledger.js')
    );

    // Demo client rpc already returns { data: null, error: null } — exactly the
    // offline/undeployed shape. Seed a product and confirm the fallback works.
    await supabase.from('products').insert([{
      id: 'product-atomic-fallback',
      item_number: 'ATOMIC-3',
      description: 'Fallback Product',
      on_hand_qty: 5,
      cost: 2,
      company_id: 'company-atomic',
      location_id: 'location-atomic',
    }]);

    const result = await applyInventoryLedgerEntry({
      itemNumber: 'ATOMIC-3',
      deltaQty: 4,
      changeType: 'restock',
      context: {
        companyId: 'company-atomic',
        activeCompanyId: 'company-atomic',
        locationId: 'location-atomic',
        activeLocationId: 'location-atomic',
      },
    });
    assert.equal(result.qty_after, 9);
  }));

test('depleteLotsFefo uses atomic RPC payload when available', async () => {
  const { depleteLotsFefo } = require(
    path.join(repoRoot, 'backend', 'services', 'lot-depletion.js')
  );

  let fromCalled = false;
  const mockSupabase = {
    rpc: async (funcName, args) => {
      assert.equal(funcName, 'deplete_lots_fefo');
      assert.equal(args.p_item_number, 'OYSTER-001');
      assert.equal(args.p_total_qty, 7);
      return {
        data: {
          ok: true,
          depleted: [
            { lot_id: 'lot-a', lot_number: 'LOT-A', qty_taken: 5 },
            { lot_id: 'lot-b', lot_number: 'LOT-B', qty_taken: 2 },
          ],
          remaining: 0,
        },
        error: null,
      };
    },
    from() {
      fromCalled = true;
      throw new Error('non-atomic lot depletion path used despite atomic RPC being available');
    },
  };

  const result = await depleteLotsFefo(mockSupabase, 'OYSTER-001', 7, { createdBy: 't', context: {} });
  assert.equal(fromCalled, false);
  assert.equal(result.remaining, 0);
  assert.equal(result.depleted.length, 2);
  assert.equal(result.depleted[0].lot_id, 'lot-a');
  assert.equal(result.depleted[0].qty_taken, 5);
});
