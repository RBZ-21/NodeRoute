'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPurchasingSuggestions } = require('../lib/purchasing-shared');

test('advanced vendor planning is inactive when vendor configuration is absent', () => {
  const suggestions = buildPurchasingSuggestions(
    [
      { id: 'prod-cod', item_number: 'COD-1', name: 'Cod Fillet', unit: 'lb', stock_qty: 0, cost: 10 },
    ],
    new Map([['cod fillet', 30]]),
    {
      coverageDays: 2,
      leadTimeDays: 1,
      lookbackDays: 10,
    }
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].suggested_order_qty, 9);
  assert.equal(suggestions[0].lead_time_days, 1);
  assert.equal(suggestions[0].lead_time_source, 'manual');
  assert.equal(suggestions[0].seasonal_coefficient, 1);
  assert.equal(suggestions[0].vendor_minimum_warning, null);
});

test('advanced vendor planning applies seasonal usage, vendor lead time, and pallet rounding', () => {
  const suggestions = buildPurchasingSuggestions(
    [
      { id: 'prod-shrimp', item_number: 'SHR-1', name: 'Shrimp', unit: 'case', stock_qty: 0, cost: 4 },
    ],
    new Map([['shrimp', 20]]),
    {
      coverageDays: 2,
      leadTimeDays: 0,
      lookbackDays: 10,
      asOfDate: '2026-06-15',
      vendorConfig: {
        lead_time_days: 3,
        pallet_qty: 12,
        min_order_value: 150,
        seasonal_usage_windows: [
          { start_month: 6, end_month: 8, coefficient: 1.5 },
        ],
      },
    }
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].avg_daily_usage, 3);
  assert.equal(suggestions[0].seasonal_coefficient, 1.5);
  assert.equal(suggestions[0].lead_time_days, 3);
  assert.equal(suggestions[0].lead_time_source, 'vendor_config');
  assert.equal(suggestions[0].pre_round_suggested_order_qty, 15);
  assert.equal(suggestions[0].suggested_order_qty, 24);
  assert.equal(suggestions[0].vendor_rounding_source, 'pallet');
  assert.equal(suggestions[0].vendor_rounding_multiple, 12);
  assert.equal(suggestions[0].suggested_order_date, '2026-06-18');
  assert.deepEqual(suggestions[0].vendor_minimum_warning, {
    min_order_value: 150,
    estimated_order_value: 96,
    shortfall: 54,
  });
});
