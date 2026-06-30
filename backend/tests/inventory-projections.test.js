'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('inventory projection combines current stock, scheduled PO receipts, and open order allocations', async () => {
  const { buildInventoryProjection } = require('../services/inventory-projections');

  const projection = await buildInventoryProjection({
    productId: 'product-proj',
    days: 5,
    today: '2026-06-28',
    supabaseClient: {
      from(table) {
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [{ id: 'product-proj', item_number: 'PROJ-1', on_hand_qty: 10 }], error: null }),
              }),
            }),
          };
        }
        if (table === 'inventory_lots') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ data: [{ product_id: 'product-proj', qty_on_hand: 4 }], error: null }),
              }),
            }),
          };
        }
        if (table === 'purchase_orders') {
          return {
            select: () => ({
              in: () => Promise.resolve({
                data: [{
                  status: 'open',
                  expected_date: '2026-06-30',
                  items: [{ product_id: 'product-proj', item_number: 'PROJ-1', qty: 8 }],
                }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'orders') {
          return {
            select: () => ({
              in: () => Promise.resolve({
                data: [{
                  status: 'open',
                  delivery_date: '2026-07-01',
                  items: [{ product_id: 'product-proj', item_number: 'PROJ-1', qty: 5 }],
                }],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  });

  assert.deepEqual(projection.map((row) => [row.date, row.projected_qty]), [
    ['2026-06-28', 14],
    ['2026-06-29', 14],
    ['2026-06-30', 22],
    ['2026-07-01', 17],
    ['2026-07-02', 17],
  ]);
});
