const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { generatePurchaseOrderNumber } = require('../services/purchase-order-numbers');

const repoRoot = path.resolve(__dirname, '..', '..');
const purchaseOrdersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'purchase-orders.js'), 'utf8');
const lotPoMigrationSource = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20260508_lot_codes_source_po_number.sql'), 'utf8');

test('generatePurchaseOrderNumber creates a timestamped PO identifier', () => {
  const fixedDate = new Date(2026, 4, 8, 14, 3, 9);
  const originalRandom = Math.random;
  Math.random = () => 0.123456789;

  try {
    const poNumber = generatePurchaseOrderNumber(fixedDate);
    assert.match(poNumber, /^PO-20260508-140309-[A-Z0-9]{3}$/);
  } finally {
    Math.random = originalRandom;
  }
});

test('purchase-order confirm flow and migration include explicit lot-to-PO linking', () => {
  assert.match(lotPoMigrationSource, /add column if not exists source_po_number text/i);
  assert.match(purchaseOrdersRouteSource, /source_po_number:\s+resolvedPoNumber/);
});
