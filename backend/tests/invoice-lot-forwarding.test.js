const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { invoiceLotEntriesFromItems, normalizeInvoiceLots, invoiceLotSummaryLines } = require('../services/invoice-lots');

const repoRoot = path.resolve(__dirname, '..', '..');
const ordersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'orders.js'), 'utf8');
const invoiceEmailServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'invoice-email.js'), 'utf8');
const invoicePdfServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'pdf.js'), 'utf8');
const invoicesRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'invoices.js'), 'utf8');

test('invoice lot helper derives lot rows from weight and count items', () => {
  const lots = invoiceLotEntriesFromItems([
    {
      item_number: 'MUS-1',
      description: 'Mussels',
      lot_number: 'LOT-MUS-123',
      quantity_from_lot: 42,
      unit: 'lb',
    },
    {
      item_number: 'CLM-7',
      description: 'Clams',
      lot_number: 'LOT-CLM-7',
      requested_qty: 6,
      unit: 'each',
    },
  ]);

  assert.deepEqual(lots, [
    {
      item_number: 'MUS-1',
      description: 'Mussels',
      lot_number: 'LOT-MUS-123',
      qty: undefined,
      weight: 42,
    },
    {
      item_number: 'CLM-7',
      description: 'Clams',
      lot_number: 'LOT-CLM-7',
      qty: 6,
      weight: undefined,
    },
  ]);
});

test('normalizeInvoiceLots merges explicit invoice lots with derived item lots', () => {
  const lots = normalizeInvoiceLots({
    lot_numbers: [
      { item_number: 'SAL-1', description: 'Salmon', lot_number: 'LOT-SAL-1', qty: 3 },
    ],
    items: [
      { item_number: 'SAL-1', description: 'Salmon', lot_number: 'LOT-SAL-1', quantity: 3, unit: 'each' },
      { item_number: 'MUS-1', description: 'Mussels', lot_number: 'LOT-MUS-1', quantity_from_lot: 15, unit: 'lb' },
    ],
  });

  assert.deepEqual(lots, [
    {
      item_number: 'SAL-1',
      description: 'Salmon',
      lot_number: 'LOT-SAL-1',
      qty: 3,
      weight: undefined,
    },
    {
      item_number: 'MUS-1',
      description: 'Mussels',
      lot_number: 'LOT-MUS-1',
      qty: undefined,
      weight: 15,
    },
  ]);
});

test('invoice lot summary lines are customer-readable', () => {
  const lines = invoiceLotSummaryLines({
    items: [
      { item_number: 'MUS-1', description: 'Mussels', lot_number: 'LOT-MUS-123', quantity_from_lot: 42, unit: 'lb' },
    ],
  });

  assert.deepEqual(lines, ['MUS-1 · Mussels · Lot LOT-MUS-123 · 42 lbs']);
});

test('orders route, invoice email, PDF, and invoice API all include invoice lot forwarding markers', () => {
  for (const marker of [
    "const { invoiceLotEntriesFromItems } = require('../services/invoice-lots');",
    'lot_numbers: lotNumbers,',
    'item.lot_number ? `Lot: ${item.lot_number}` : \'\'',
    "const { normalizeInvoiceLots } = require('./invoice-lots');",
    'Traceability Lot Summary',
    "const { normalizeInvoiceLots } = require('../services/invoice-lots');",
    'lot_numbers: normalizeInvoiceLots(invoice),',
  ]) {
    const source =
      ordersRouteSource.includes(marker) ? ordersRouteSource :
      invoicePdfServiceSource.includes(marker) ? invoicePdfServiceSource :
      invoiceEmailServiceSource.includes(marker) ? invoiceEmailServiceSource :
      invoicesRouteSource;
    assert.ok(source.includes(marker), `missing marker ${marker}`);
  }
});

test('customer invoice PDF uses office contact note and aligned total block', () => {
  for (const marker of [
    "const CUSTOMER_INVOICE_NOTE = 'Please contact the office if you have any questions.';",
    'doc.page.width - 50 - totalBoxX',
    'totalsAmountWidth = 90',
    '`Notes: ${CUSTOMER_INVOICE_NOTE}`',
  ]) {
    assert.ok(invoicePdfServiceSource.includes(marker), `invoice PDF missing marker ${marker}`);
  }
  assert.ok(!invoicePdfServiceSource.includes('`Notes: ${inv.notes}`'), 'customer invoice PDF should not print raw internal invoice notes');
});
