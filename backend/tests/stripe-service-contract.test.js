'use strict';

// Export-contract test for services/stripe.js.
//
// The portal payment routes (routes/portal/payments-shared.js and the
// payment-collection/method/profile routers) destructure these functions at
// require time. Destructuring a missing export yields `undefined` silently
// and only crashes when the Stripe code path runs in production — which is
// exactly how a previous refactor broke portal payments. This test makes
// that failure mode a CI failure instead.

const test = require('node:test');
const assert = require('node:assert/strict');

const stripeService = require('../services/stripe');

const REQUIRED_EXPORTS = [
  'getClient',
  'verifyWebhookSignature',
  'isStripeConfigured',
  'normalizeAmountToCents',
  'paymentMethodTypeForPortalType',
  'portalMethodTypeForStripeType',
  'findOrCreateCustomer',
  'createSetupIntent',
  'retrievePaymentMethod',
  'attachPaymentMethod',
  'detachPaymentMethod',
  'createPaymentIntent',
  'createCheckoutSession',
];

for (const name of REQUIRED_EXPORTS) {
  test(`services/stripe exports ${name} as a function`, () => {
    assert.equal(typeof stripeService[name], 'function');
  });
}

test('portal payments-shared resolves every stripe import to a function', () => {
  // Re-assert through the consumer module so a rename in payments-shared.js
  // is caught too.
  const shared = require('../routes/portal/payments-shared');
  for (const name of [
    'attachPaymentMethod',
    'createCheckoutSession',
    'createPaymentIntent',
    'createSetupIntent',
    'detachPaymentMethod',
    'portalMethodTypeForStripeType',
    'retrievePaymentMethod',
  ]) {
    assert.equal(typeof shared[name], 'function', `payments-shared re-export ${name}`);
  }
});

test('portalMethodTypeForStripeType maps stripe types to portal types', () => {
  assert.equal(stripeService.portalMethodTypeForStripeType('us_bank_account'), 'ach_bank');
  assert.equal(stripeService.portalMethodTypeForStripeType('card'), 'debit_card');
});

test('normalizeAmountToCents converts dollars and clamps at zero', () => {
  assert.equal(stripeService.normalizeAmountToCents(12.34), 1234);
  assert.equal(stripeService.normalizeAmountToCents(-5), 0);
  assert.equal(stripeService.normalizeAmountToCents(null), 0);
});
