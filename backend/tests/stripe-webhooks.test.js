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
    "verifyWebhookSignature(req.body, req.headers['stripe-signature']",
    "event.type === 'checkout.session.completed'",
    "event.type === 'invoice.paid'",
    "status: 'paid'",
  ]) {
    assert.ok(webhookSource.includes(marker), `missing webhook marker ${marker}`);
  }
});

// FIX [M9]: invoice.paid must be an explicit handled webhook type.
test('stripe webhook route records invoice.paid subscription billing events explicitly', () => {
  assert.match(webhookSource, /async function handleInvoicePaid/);
  assert.match(webhookSource, /subscription_details/);
  assert.match(webhookSource, /noderoute_billing_checkout/);
});

test('stripe service exposes webhook verification helpers', () => {
  for (const marker of [
    'verifyWebhookSignature',
    'Stripe-Signature',
  ]) {
    assert.ok(stripeServiceSource.includes(marker), `missing stripe service marker ${marker}`);
  }
});
