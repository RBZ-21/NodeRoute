const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const inventoryRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'inventory.js'), 'utf8');
const lotDepletionSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'lot-depletion.js'), 'utf8');
const opsRouteSource = [
  fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops.js'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops-purchasing.js'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops', 'admin-routes.js'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-shared.js'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-order-routes.js'), 'utf8'),
].join('\n');
const ordersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'orders.js'), 'utf8');
const purchaseOrdersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'purchase-orders.js'), 'utf8');
const ledgerServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'inventory-ledger.js'), 'utf8');

test('inventory route exposes dedicated ledger movement endpoints', () => {
  for (const endpoint of [
    "router.post('/:id/pick'",
    "router.post('/:id/spoilage'",
    "router.post('/transfer'",
    "router.get('/ledger'",
  ]) {
    assert.ok(inventoryRouteSource.includes(endpoint), `missing endpoint ${endpoint}`);
  }
});

test('inventory ledger service provides shared posting primitives', () => {
  for (const marker of [
    'async function applyInventoryLedgerEntry',
    'async function transferInventoryLedgerEntry',
    "change_type: String(changeType || 'adjustment').trim() || 'adjustment'",
    'on_hand_weight is a separate physical measurement',
  ]) {
    assert.ok(ledgerServiceSource.includes(marker), `missing ledger marker ${marker}`);
  }
});

test('fulfillment and purchasing workflows post through unified inventory ledger', () => {
  for (const marker of [
    "const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');",
    "changeType: 'pick'",
  ]) {
    assert.ok(ordersRouteSource.includes(marker), `orders missing marker ${marker}`);
  }

  for (const marker of [
    "const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');",
    "changeType: 'restock'",
  ]) {
    assert.ok(purchaseOrdersRouteSource.includes(marker), `purchase-orders missing marker ${marker}`);
  }

  assert.ok(
    opsRouteSource.includes("const { applyInventoryLedgerEntry } = require('../../services/inventory-ledger');")
    || opsRouteSource.includes("const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');")
  );
  assert.ok(opsRouteSource.includes("notes: `PO ${po.po_number} receipt (${po.vendor})`"));
});

test('purchase orders are tenant-scoped with company and location context', () => {
  for (const marker of [
    'buildScopeFields,',
    'filterRowsByContext,',
    'insertRecordWithOptionalScope,',
    ".select('item_number, description, on_hand_qty, cost, unit, is_ftl_regulated, company_id, location_id')",
    "'id, po_number, vendor, total_cost, items, confirmed_by, created_at, company_id, location_id'",
    "filterRowsByContext(result.data || [], req.context)",
    "poInsert = await insertRecordWithOptionalScope(supabase, 'purchase_orders', poPayload, req.context)",
    "...buildScopeFields(req.context)",
  ]) {
    assert.ok(purchaseOrdersRouteSource.includes(marker), `purchase-orders missing tenant-scope marker ${marker}`);
  }
});

test('lot-depletion service implements FEFO ordering', () => {
  assert.ok(lotDepletionSource.includes('async function depleteLotsFefo'), 'depleteLotsFefo function missing');
  assert.ok(lotDepletionSource.includes("order('expiry_date', { ascending: true, nullsFirst: false })"), 'FEFO expiry ordering missing');
  assert.ok(lotDepletionSource.includes("order('created_at', { ascending: true })"), 'FEFO created_at tiebreak ordering missing');
  assert.ok(lotDepletionSource.includes("status: newStatus"), 'lot status update to depleted missing');
  assert.ok(inventoryRouteSource.includes("require('../services/lot-depletion')"), 'inventory route must import lot-depletion service');
  assert.ok(inventoryRouteSource.includes('depleteLotsFefo'), 'inventory pick route must call depleteLotsFefo');
});

test('depleteLotsFefo correctly applies FEFO order and returns remaining qty', async () => {
  const { depleteLotsFefo: fefo } = require(path.join(repoRoot, 'backend', 'services', 'lot-depletion.js'));

  const lotA = { id: 'lot-a', lot_number: 'LOT-A', qty_on_hand: 5, expiry_date: '2026-06-01', created_at: '2026-01-01', status: 'active' };
  const lotB = { id: 'lot-b', lot_number: 'LOT-B', qty_on_hand: 10, expiry_date: '2026-08-01', created_at: '2026-01-02', status: 'active' };

  const updates = {};

  // Build a chainable mock supabase that returns lots in FEFO order on select,
  // and records updates by lot id.
  function makeSelectChain(returnLots) {
    const chain = {
      eq: () => chain,
      gt: () => chain,
      order: () => chain,
      then: (resolve) => resolve({ data: returnLots, error: null }),
    };
    return chain;
  }

  function makeUpdateChain(lotId) {
    const chain = {
      eq: (col, val) => { if (col === 'id') updates[val] = chain._payload; return chain; },
      then: (resolve) => resolve({ error: null }),
    };
    chain._payload = null;
    return chain;
  }

  const mockSupabase = {
    from(table) {
      if (table === 'inventory_lots') {
        return {
          select() { return makeSelectChain([lotA, lotB]); },
          update(payload) {
            const updateId = Object.keys(updates).length === 0 ? 'lot-a' : 'lot-b';
            updates[updateId] = payload;
            const chain = { eq: () => chain, then: (resolve) => resolve({ error: null }) };
            return chain;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const result = await fefo(mockSupabase, 'OYSTER-001', 7, { createdBy: 'test', context: {} });

  assert.strictEqual(result.remaining, 0, 'remaining should be 0 after depleting 7 from 15 total');
  assert.strictEqual(result.depleted.length, 2, 'should have depleted 2 lots');
  assert.strictEqual(result.depleted[0].lot_id, 'lot-a', 'lot A (earlier expiry) depleted first');
  assert.strictEqual(result.depleted[0].qty_taken, 5, 'lot A fully depleted (qty_taken = 5)');
  assert.strictEqual(result.depleted[1].lot_id, 'lot-b', 'lot B depleted second');
  assert.strictEqual(result.depleted[1].qty_taken, 2, 'lot B partially depleted (qty_taken = 2)');
});

test('depleteLotsFefo returns remaining > 0 when lots are insufficient', async () => {
  const { depleteLotsFefo: fefo } = require(path.join(repoRoot, 'backend', 'services', 'lot-depletion.js'));

  const lotA = { id: 'lot-a', lot_number: 'LOT-A', qty_on_hand: 5, expiry_date: '2026-06-01', created_at: '2026-01-01', status: 'active' };
  const lotB = { id: 'lot-b', lot_number: 'LOT-B', qty_on_hand: 10, expiry_date: '2026-08-01', created_at: '2026-01-02', status: 'active' };

  const mockSupabase = {
    from(table) {
      if (table === 'inventory_lots') {
        return {
          select() {
            const chain = { eq: () => chain, gt: () => chain, order: () => chain, then: (resolve) => resolve({ data: [lotA, lotB], error: null }) };
            return chain;
          },
          update() {
            const chain = { eq: () => chain, then: (resolve) => resolve({ error: null }) };
            return chain;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const result = await fefo(mockSupabase, 'OYSTER-001', 20, { createdBy: 'test', context: {} });

  assert.ok(result.remaining > 0, `remaining should be > 0 when requesting 20 but only 15 available; got ${result.remaining}`);
  assert.strictEqual(result.remaining, 5, 'remaining should be 5 (20 requested - 15 available)');
});

test('inventory ledger remains backward compatible when cost metadata is omitted', async () => {
  const backupRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'noderoute-ledger-backcompat-'));
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;

  process.env.NODEROUTE_BACKUP_PATH = backupRoot;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}inventory-ledger.js`)
    ) {
      delete require.cache[key];
    }
  }

  try {
    const { supabase } = require(path.join(repoRoot, 'backend', 'services', 'supabase.js'));
    const { applyInventoryLedgerEntry } = require(path.join(repoRoot, 'backend', 'services', 'inventory-ledger.js'));
    await supabase.from('products').insert([{
      id: 'product-backcompat',
      item_number: 'BACKCOMPAT-1',
      description: 'Backcompat Product',
      on_hand_qty: 5,
      cost: 2,
      company_id: 'company-ledger',
      location_id: 'location-ledger',
    }]);

    const result = await applyInventoryLedgerEntry({
      itemNumber: 'BACKCOMPAT-1',
      deltaQty: 2,
      changeType: 'adjustment',
      context: {
        companyId: 'company-ledger',
        activeCompanyId: 'company-ledger',
        locationId: 'location-ledger',
        activeLocationId: 'location-ledger',
      },
    });

    assert.equal(result.qty_after, 7);
    assert.equal(result.entry.cost_basis, null);
    assert.equal(result.entry.uom, null);
    assert.equal(result.entry.conversion_factor, null);
    assert.equal(result.entry.ledger_ref, null);
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    for (const key of Object.keys(require.cache)) {
      if (
        key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
        key.includes(`${path.sep}backend${path.sep}services${path.sep}inventory-ledger.js`)
      ) {
        delete require.cache[key];
      }
    }
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
});
