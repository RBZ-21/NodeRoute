const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPurchasingSuggestions, summarizeVendorPurchaseOrders, resolveHistoricalLeadTimeDays } = require('../lib/purchasing-shared');

test('summarizeVendorPurchaseOrders calculates actual and historical lead-time metrics', () => {
  const orders = summarizeVendorPurchaseOrders([
    {
      id: 'po-1',
      po_number: 'PO-1',
      vendor: 'Blue Ocean Seafood',
      status: 'received',
      created_at: '2026-04-01T00:00:00Z',
      lines: [
        { line_no: 1, item_number: 'SAL-1', product_name: 'Salmon', ordered_qty: 10, received_qty: 10, unit_cost: 12 },
        { line_no: 2, item_number: 'BOX-1', product_name: 'Shipping Box', ordered_qty: 5, received_qty: 5, unit_cost: 2 },
      ],
      receipts: [
        {
          id: 'rcv-1a',
          received_at: '2026-04-02T00:00:00Z',
          lines: [{ line_no: 1, item_number: 'SAL-1', qty_received: 10 }],
        },
        {
          id: 'rcv-1b',
          received_at: '2026-04-04T00:00:00Z',
          lines: [{ line_no: 2, item_number: 'BOX-1', qty_received: 5 }],
        },
      ],
    },
    {
      id: 'po-2',
      po_number: 'PO-2',
      vendor: 'Blue Ocean Seafood',
      status: 'received',
      created_at: '2026-04-05T00:00:00Z',
      lines: [
        { line_no: 1, item_number: 'SAL-1', product_name: 'Salmon', ordered_qty: 8, received_qty: 8, unit_cost: 13 },
        { line_no: 2, item_number: 'BOX-1', product_name: 'Shipping Box', ordered_qty: 6, received_qty: 6, unit_cost: 2.1 },
      ],
      receipts: [
        {
          id: 'rcv-2a',
          received_at: '2026-04-06T00:00:00Z',
          lines: [{ line_no: 2, item_number: 'BOX-1', qty_received: 6 }],
        },
        {
          id: 'rcv-2b',
          received_at: '2026-04-09T00:00:00Z',
          lines: [{ line_no: 1, item_number: 'SAL-1', qty_received: 8 }],
        },
      ],
    },
  ]);

  assert.equal(orders[0].first_receipt_lead_time_days, 1);
  assert.equal(orders[1].first_receipt_lead_time_days, 1);
  assert.equal(orders[0].lines[0].first_receipt_lead_time_days, 1);
  assert.equal(orders[0].lines[1].first_receipt_lead_time_days, 3);
  assert.equal(orders[1].lines[0].first_receipt_lead_time_days, 4);
  assert.equal(orders[0].lead_time_history.average_days, 1);
  assert.equal(orders[0].lead_time_history.median_days, 1);
  assert.equal(orders[0].lead_time_history.receipt_count, 2);
  assert.equal(orders[0].lines[0].lead_time_history.average_days, 2.5);
  assert.equal(orders[0].lines[0].lead_time_history.latest_days, 4);
  assert.equal(orders[0].lines[0].lead_time_history.receipt_count, 2);
  assert.equal(orders[0].lines[1].lead_time_history.average_days, 2);
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

test('resolveHistoricalLeadTimeDays prefers vendor and product history when line context is provided', () => {
  const orders = summarizeVendorPurchaseOrders([
    {
      id: 'po-1',
      po_number: 'PO-1',
      vendor: 'Blue Ocean Seafood',
      status: 'received',
      created_at: '2026-04-01T00:00:00Z',
      lines: [
        { line_no: 1, item_number: 'SAL-1', product_name: 'Salmon', ordered_qty: 10, received_qty: 10, unit_cost: 12 },
        { line_no: 2, item_number: 'BOX-1', product_name: 'Shipping Box', ordered_qty: 5, received_qty: 5, unit_cost: 2 },
      ],
      receipts: [
        { id: 'rcv-1', received_at: '2026-04-02T00:00:00Z', lines: [{ line_no: 1, item_number: 'SAL-1', qty_received: 10 }] },
        { id: 'rcv-2', received_at: '2026-04-04T00:00:00Z', lines: [{ line_no: 2, item_number: 'BOX-1', qty_received: 5 }] },
      ],
    },
    {
      id: 'po-2',
      po_number: 'PO-2',
      vendor: 'Blue Ocean Seafood',
      status: 'received',
      created_at: '2026-04-05T00:00:00Z',
      lines: [
        { line_no: 1, item_number: 'SAL-1', product_name: 'Salmon', ordered_qty: 8, received_qty: 8, unit_cost: 13 },
      ],
      receipts: [
        { id: 'rcv-3', received_at: '2026-04-09T00:00:00Z', lines: [{ line_no: 1, item_number: 'SAL-1', qty_received: 8 }] },
      ],
    },
  ]);

  const salmonLead = resolveHistoricalLeadTimeDays(orders, 'Blue Ocean Seafood', { item_number: 'SAL-1', product_name: 'Salmon' });
  const boxLead = resolveHistoricalLeadTimeDays(orders, 'Blue Ocean Seafood', { item_number: 'BOX-1', product_name: 'Shipping Box' });

  assert.equal(salmonLead.source, 'historical_product');
  assert.equal(salmonLead.leadTimeDays, 3);
  assert.equal(salmonLead.history.average_days, 2.5);
  assert.equal(boxLead.leadTimeDays, 3);
  assert.equal(boxLead.history.average_days, 3);
});

test('buildPurchasingSuggestions can apply per-product lead times when provided', () => {
  const suggestions = buildPurchasingSuggestions(
    [
      { id: 'inv-1', item_number: 'SAL-1', description: 'Salmon', unit: 'lb', on_hand_qty: 3, cost: 12 },
      { id: 'inv-2', item_number: 'BOX-1', description: 'Shipping Box', unit: 'each', on_hand_qty: 3, cost: 2 },
    ],
    new Map([
      ['salmon', 10],
      ['shipping box', 10],
    ]),
    {
      coverageDays: 3,
      leadTimeDays: 1,
      lookbackDays: 10,
      leadTimeResolver: (item) => String(item.item_number) === 'SAL-1'
        ? { leadTimeDays: 4, source: 'historical_product', history: { average_days: 4, receipt_count: 2 } }
        : { leadTimeDays: 1, source: 'historical', history: { average_days: 1, receipt_count: 1 } },
    }
  );

  const salmonSuggestion = suggestions.find((suggestion) => suggestion.item_number === 'SAL-1');
  const boxSuggestion = suggestions.find((suggestion) => suggestion.item_number === 'BOX-1');

  assert.equal(salmonSuggestion.lead_time_days, 4);
  assert.equal(salmonSuggestion.lead_time_source, 'historical_product');
  assert.equal(salmonSuggestion.suggested_order_qty, 4);
  assert.equal(boxSuggestion.lead_time_days, 1);
  assert.equal(boxSuggestion.lead_time_source, 'historical');
  assert.equal(boxSuggestion.suggested_order_qty, 1);
});
