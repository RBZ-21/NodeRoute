const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const webhookSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stripe-webhooks.js'), 'utf8');
const collectionSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-collection-routes.js'), 'utf8');
const legacyAutopaySource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal-autopay.js'), 'utf8');
const legacyInvoicePaySource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'portal-invoice-payments.js'), 'utf8');

test('portal checkout metadata identifies checkout scope for webhook reconciliation', () => {
  for (const marker of [
    "checkout_type: 'portal_checkout'",
    'customer_email: req.customerEmail',
    "company_id: req.portalContext.companyId || ''",
    "location_id: req.portalContext.activeLocationId || ''",
  ]) {
    assert.ok(collectionSource.includes(marker), `active portal checkout missing marker ${marker}`);
    assert.ok(legacyInvoicePaySource.includes(marker), `legacy portal checkout missing marker ${marker}`);
  }
});

test('portal payment actions use stable invoice-scoped idempotency keys', () => {
  assert.ok(collectionSource.includes('function portalPaymentIdempotencyKey('), 'active portal flow should centralize idempotency keys');
  assert.ok(!collectionSource.includes('portal-invoice-pay-${invoiceRow.id}-${Date.now()}'), 'active invoice pay should not use Date.now in idempotency key');
  assert.ok(!collectionSource.includes('portal-autopay-${invoice.id}-${Date.now()}'), 'active autopay should not use Date.now in idempotency key');
  assert.ok(!legacyAutopaySource.includes('portal-autopay-${invoice.id}-${Date.now()}'), 'legacy autopay should not use Date.now in idempotency key');
  assert.ok(!legacyInvoicePaySource.includes('portal-invoice-pay-${invoiceRow.id}-${Date.now()}'), 'legacy invoice pay should not use Date.now in idempotency key');
});

test('successful portal charges stamp paid_at rather than sent_at', () => {
  for (const source of [collectionSource, legacyAutopaySource, legacyInvoicePaySource]) {
    assert.ok(source.includes("paid_at: paidAt"), 'portal payment flow should write paid_at');
    assert.ok(source.includes("paid_date: paidAt"), 'portal payment flow should also write paid_date');
    assert.ok(!source.includes("status: 'paid', sent_at:"), 'portal payment flow must not misuse sent_at for payment reconciliation');
  }
});

test('portal checkout webhook only settles the scoped customer invoices', () => {
  for (const marker of [
    "const { company_id, invoice_id, checkout_type, source, customer_email, location_id } = session.metadata || {};",
    "if (checkout_type === 'portal_checkout' || source === 'portal_checkout')",
    ".ilike('customer_email', customer_email)",
    'filterRowsByContext(',
    'buildPortalWebhookContext({ company_id, location_id })',
    "String(inv.customer_email || '').toLowerCase() !== String(customer_email || '').toLowerCase()",
    'invoiceIsWebhookPayable',
  ]) {
    assert.ok(webhookSource.includes(marker), `webhook missing portal hardening marker ${marker}`);
  }
});
