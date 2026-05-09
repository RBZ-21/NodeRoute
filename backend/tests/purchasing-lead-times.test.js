const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeVendorPurchaseOrders, resolveHistoricalLeadTimeDays } = require('../routes/ops/purchasing-shared');

test('summarizeVendorPurchaseOrders calculates actual and historical lead-time metrics', () => {
  const orders = summarizeVendorPurchaseOrders([
    {
      id: 'po-1',
      po_number: 'PO-1',
      vendor: 'Blue Ocean Seafood',
      status: 'received',
      created_at: '2026-04-10T12:00:00Z',
      lines: [{ line_no: 1, product_name: 'Salmon', ordered_qty: 10, received_qty: 10, unit_cost: 12 }],
      receipts: [{ id: 'rcv-1', received_at: '2026-04-12T12:00:00Z' }],
    },
    {
      id: 'po-2',
      po_number: 'PO-2',
      vendor: 'Blue Ocean Seafood',
      status: 'received',
      created_at: '2026-04-13T12:00:00Z',
      lines: [{ line_no: 1, product_name: 'Scallops', ordered_qty: 5, received_qty: 5, unit_cost: 20 }],
      receipts: [{ id: 'rcv-2', received_at: '2026-04-14T12:00:00Z' }],
    },
  ]);

  assert.equal(orders[0].first_receipt_lead_time_days, 2);
  assert.equal(orders[1].first_receipt_lead_time_days, 1);
  assert.equal(orders[0].lead_time_history.average_days, 1.5);
  assert.equal(orders[0].lead_time_history.median_days, 1.5);
  assert.equal(orders[0].lead_time_history.receipt_count, 2);
});

test('resolveHistoricalLeadTimeDays prefers vendor history over defaults', () => {
  const orders = summarizeVendorPurchaseOrders([
    {
      id: 'po-1',
      po_number: 'PO-1',
      vendor: 'Harbor Supply',
      status: 'received',
      created_at: '2026-04-10T12:00:00Z',
      lines: [{ line_no: 1, product_name: 'Boxes', ordered_qty: 10, received_qty: 10, unit_cost: 2 }],
      receipts: [{ id: 'rcv-1', received_at: '2026-04-13T12:00:00Z' }],
    },
  ]);

  const resolved = resolveHistoricalLeadTimeDays(orders, 'Harbor Supply');
  assert.equal(resolved.source, 'historical');
  assert.equal(resolved.leadTimeDays, 3);
  assert.equal(resolved.history.average_days, 3);
});
