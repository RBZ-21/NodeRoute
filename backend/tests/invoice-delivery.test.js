const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractOrderNumberFromStopNotes,
  isOpenUnpaidInvoiceStatus,
  mergeInvoiceNotesWithDriverNotes,
  statusAfterDeliveryCompletion,
  statusAfterInvoiceEmail,
} = require('../services/invoice-delivery');

test('delivery completion marks open invoices delivered and preserves terminal states', () => {
  assert.equal(statusAfterDeliveryCompletion('pending'), 'delivered');
  assert.equal(statusAfterDeliveryCompletion('signed'), 'delivered');
  assert.equal(statusAfterDeliveryCompletion('sent'), 'delivered');
  assert.equal(statusAfterDeliveryCompletion('overdue'), 'delivered');
  assert.equal(statusAfterDeliveryCompletion('paid'), 'paid');
  assert.equal(statusAfterDeliveryCompletion('void'), 'void');
});

test('invoice email preserves delivered invoices while still advancing signed invoices to sent', () => {
  assert.equal(statusAfterInvoiceEmail('signed'), 'sent');
  assert.equal(statusAfterInvoiceEmail('delivered'), 'delivered');
  assert.equal(statusAfterInvoiceEmail('paid'), 'paid');
  assert.equal(statusAfterInvoiceEmail('canceled'), 'cancelled');
});

test('driver notes merge into invoice notes without duplicating stale driver-note lines', () => {
  const merged = mergeInvoiceNotesWithDriverNotes(
    'Awaiting final weights\nDriver notes: Old note',
    'Leave by the side door',
  );
  assert.equal(merged, 'Awaiting final weights\nDriver notes: Leave by the side door');
  assert.equal(mergeInvoiceNotesWithDriverNotes('Driver notes: Old note', ''), null);
});

test('stop note parsing can recover the linked order number', () => {
  assert.equal(extractOrderNumberFromStopNotes('Order ORD-123'), 'ORD-123');
  assert.equal(extractOrderNumberFromStopNotes('Blue Fin / Order ord-456 / Tuesday'), 'ord-456');
  assert.equal(extractOrderNumberFromStopNotes('No linked order'), null);
});

test('delivered invoices remain open for receivables and portal payment flows', () => {
  assert.equal(isOpenUnpaidInvoiceStatus('delivered'), true);
  assert.equal(isOpenUnpaidInvoiceStatus('paid'), false);
});
