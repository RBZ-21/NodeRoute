const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const serverSource = fs.readFileSync(path.join(repoRoot, 'backend', 'server.js'), 'utf8');
const webhookSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stripe-webhooks.js'), 'utf8');
const stripeServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'stripe.js'), 'utf8');

test('server mounts Stripe webhook endpoint with raw JSON body parser', () => {
  assert.ok(serverSource.includes("app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler)"));
  assert.ok(serverSource.includes("const { stripeWebhookHandler } = require('./routes/stripe-webhooks');"));
});

test('stripe webhook route validates signatures and handles payment events', () => {
  for (const marker of [
    'verifyWebhookSignature(rawBody, signature)',
    "event.type === 'payment_intent.succeeded'",
    "event.type === 'payment_intent.payment_failed'",
    "event.type === 'checkout.session.completed'",
    "status: 'paid'",
    "provider: 'stripe'",
  ]) {
    assert.ok(webhookSource.includes(marker), `missing webhook marker ${marker}`);
  }
});

test('stripe service exposes setup/payment intent and webhook verification helpers', () => {
  for (const marker of [
    'createSetupIntent',
    'createPaymentIntent',
    'createCheckoutSession',
    'verifyWebhookSignature',
    'portalMethodTypeForStripeType',
  ]) {
    assert.ok(stripeServiceSource.includes(marker), `missing stripe service marker ${marker}`);
  }
});
