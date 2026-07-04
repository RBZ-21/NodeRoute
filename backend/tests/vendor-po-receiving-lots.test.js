const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const receiveRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-order-routes.js'),
  'utf8'
);
const { normalizePoLine, poLineRequiresLot } = require('../lib/purchasing-shared');

test('vendor PO lines preserve lot metadata needed by receipt drafts', () => {
  const normalized = normalizePoLine({
    product_name: 'Fresh Clams',
    category: 'Mollusks',
    item_number: 'CLAM-1',
    quantity: 5,
    unit: 'lb',
    unit_cost: 7.5,
    lot_number: 'CLAM-LOT-1',
  }, 0);

  assert.equal(normalized.category, 'Mollusks');
  assert.equal(normalized.lot_number, 'CLAM-LOT-1');
  assert.equal(poLineRequiresLot(normalized), true);
  assert.equal(poLineRequiresLot({ product_name: 'Fresh Salmon', category: 'Seafood' }), false);
});

test('vendor PO receipt route enforces mollusk lots and records them in lot_codes', () => {
  assert.match(receiveRouteSource, /poLineRequiresLot\(poLine\)\s*&&\s*!String\(rawLine\.lot_number \|\| ''\)\.trim\(\)/);
  assert.match(receiveRouteSource, /lot_number:\s+lotNumber/);
  assert.match(receiveRouteSource, /from\('lot_codes'\)\.insert\(\[candidate\]\)\.select\('id'\)\.single\(\)/);
  assert.match(receiveRouteSource, /source_po_number:\s+po\.po_number \|\| null/);
});
