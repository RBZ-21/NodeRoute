const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePOScan } = require('../services/ai');

test('normalizePOScan infers item type from unit and keeps scan lot metadata', () => {
  const result = normalizePOScan({
    vendor: 'Blue Ocean Seafood',
    po_number: 'PO-SCAN-1',
    date: '2026-05-08',
    total_cost: null,
    items: [
      {
        description: 'Fresh Salmon',
        category: 'Seafood',
        quantity: 5,
        unit: 'lb',
        unit_price: 12.5,
        total: null,
        item_type: 'unknown',
        lot_number: 'SAL-LOT-9',
        lot_number_confidence: 'high',
      },
      {
        description: 'Shipping Box',
        category: 'Packaging',
        quantity: 2,
        unit: 'case',
        unit_price: 18,
        total: null,
        item_type: 'unknown',
        lot_number: null,
        lot_number_confidence: null,
      },
    ],
  });

  assert.equal(result.items[0].item_type, 'weighted');
  assert.equal(result.items[0].lot_number, 'SAL-LOT-9');
  assert.equal(result.items[0].lot_number_confidence, 'high');
  assert.equal(result.items[0].total, 62.5);

  assert.equal(result.items[1].item_type, 'count');
  assert.equal(result.items[1].lot_number, null);
  assert.equal(result.items[1].lot_number_confidence, 'none');
  assert.equal(result.items[1].total, 36);
});
