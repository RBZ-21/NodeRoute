const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const inventoryRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'inventory.js'), 'utf8');
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
    "on_hand_weight: nextQty",
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
