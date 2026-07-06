const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildLotNoticeEmail,
  groupLotNoticeRecipients,
} = require('../services/lot-traceability-notice');

const repoRoot = path.resolve(__dirname, '..', '..');
const lotsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'lots.js'), 'utf8');

test('lot traceability notices group orders by unique customer email', () => {
  const grouped = groupLotNoticeRecipients([
    { order_number: 'ORD-100', customer: 'Blue Fin', customer_email: 'dock@bluefin.test', quantity: 5 },
    { order_number: 'ORD-101', customer: 'Blue Fin', customer_email: 'DOCK@bluefin.test', quantity: 7 },
    { order_number: 'ORD-200', customer: 'Harbor House', customer_email: 'chef@harbor.test', quantity: 3 },
    { order_number: 'ORD-300', customer: 'No Email', customer_email: '', quantity: 1 },
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].recipient, 'dock@bluefin.test');
  assert.deepEqual(grouped[0].orders.map((order) => order.order_number), ['ORD-100', 'ORD-101']);
  assert.equal(grouped[1].recipient, 'chef@harbor.test');
});

test('lot traceability notice email stays scoped to the recipient order history', () => {
  const email = buildLotNoticeEmail({
    businessName: 'NodeRoute Seafood',
    lot: {
      lot_number: 'LOT-77',
      product: 'Fresh Clams',
      vendor: 'North Sea',
      received_date: '2026-05-01',
    },
    customerName: 'Blue Fin',
    orders: [
      { order_number: 'ORD-100', quantity: 5, delivery_date: '2026-05-03', status: 'delivered' },
      { order_number: 'ORD-101', quantity: 7, delivery_date: '2026-05-04', status: 'invoiced' },
    ],
    sentAt: new Date('2026-05-09T12:00:00Z'),
  });

  assert.match(email.subject, /LOT-77/);
  assert.match(email.text, /ORD-100/);
  assert.match(email.text, /ORD-101/);
  assert.match(email.html, /Fresh Clams/);
  assert.match(email.html, /Blue Fin/);
});

test('traceability routes support vendor filtering and standalone customer notices', () => {
  // BE-005: the vendor filter now escapes LIKE metacharacters before .ilike().
  assert.match(lotsRouteSource, /if \(vendor\)\s+query = query\.ilike\('vendor_id', `%\$\{escapeLike\(vendor\)\}%`\)/);
  assert.match(lotsRouteSource, /router\.post\('\/:lotNumber\/notice'/);
  assert.match(lotsRouteSource, /groupLotNoticeRecipients\(traceData\.data\.orders\)/);
  assert.match(lotsRouteSource, /buildLotNoticeEmail\(/);
});
