'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPurchasingSuggestions,
  buildVendorPlanningSummary,
} = require('../lib/purchasing-shared');

test('vendor minimum summary warns without fabricating filler items', () => {
  const summary = buildVendorPlanningSummary(
    [
      { suggested_order_qty: 4, estimated_unit_cost: 20 },
      { suggested_order_qty: 2, estimated_unit_cost: 10 },
    ],
    { min_order_value: 150 }
  );

  assert.equal(summary.total_estimated_cost, 100);
  assert.equal(summary.minimum_order_warning.min_order_value, 150);
  assert.equal(summary.minimum_order_warning.shortfall, 50);
});

test('layer rounding is used when pallet rounding is unavailable', () => {
  const suggestions = buildPurchasingSuggestions(
    [
      { id: 'prod-box', item_number: 'BOX-1', name: 'Shipping Box', unit: 'each', stock_qty: 0, cost: 2 },
    ],
    new Map([['shipping box', 10]]),
    {
      coverageDays: 5,
      leadTimeDays: 0,
      lookbackDays: 10,
      vendorConfig: {
        layer_qty: 6,
      },
    }
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].pre_round_suggested_order_qty, 5);
  assert.equal(suggestions[0].suggested_order_qty, 6);
  assert.equal(suggestions[0].vendor_rounding_source, 'layer');
});
