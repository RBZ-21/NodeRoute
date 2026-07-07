'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const billingRouteSource = read('backend', 'routes', 'billing.js');
const serverSource = read('backend', 'server.js');
const stripeServiceSource = read('backend', 'services', 'stripe.js');
const settingsSource = read('frontend-v2', 'src', 'pages', 'SettingsPage.tsx');
const settingsHookSource = read('frontend-v2', 'src', 'hooks', 'useSettings.ts');

test('NodeRoute billing backend exposes test-only subscription checkout', () => {
  for (const marker of [
    "router.get('/config'",
    "router.post('/create-checkout-session'",
    'NODEROUTE_STRIPE_PRICE_ID',
    'NODEROUTE_TEST_PRICE_INVALID',
    'STRIPE_TEST_MODE_REQUIRED',
    'noderoute_billing_checkout',
    'noderoute-billing-',
    "mode: 'subscription'",
    'custom_pricing_enabled',
    'effective_monthly_cents',
    'effective_setup_cents',
    'billing_profile',
    "app.use('/api/billing'",
    'custom_pricing_enabled',
    'effective_monthly_cents',
    'effective_setup_cents',
  ]) {
    const source = marker === "app.use('/api/billing'" ? serverSource : `${billingRouteSource}\n${stripeServiceSource}`;
    assert.ok(source.includes(marker), `missing NodeRoute billing marker ${marker}`);
  }
});

// FIX [M8]: subscription checkout should have a Stripe-specific rate limit.
test('NodeRoute billing subscription checkout is Stripe-rate-limited', () => {
  assert.ok(billingRouteSource.includes("const { stripeLimiter } = require('../middleware/rateLimiter');"));
  assert.match(billingRouteSource, /router\.post\('\/create-checkout-session',\s*stripeLimiter,\s*requireRole\('admin'\)/);
});

test('NodeRoute billing frontend lives in authenticated Settings, not customer portal', () => {
  for (const marker of [
    'NodeRoute Billing',
    '/api/billing/config',
    '/api/billing/create-checkout-session',
    'Stripe test mode preview — no live charges',
    'This is for NodeRoute service billing, not restaurant invoice collection.',
    "billing === 'success'",
    'effective_monthly_cents',
    'effective_setup_cents',
    'custom_pricing_enabled',
    'Assigned monthly',
    'Assigned setup',
    'Custom pricing',
    'Pay Now with Stripe',
    'custom_pricing_enabled',
    'effective_monthly_cents',
    'effective_setup_cents',
  ]) {
    assert.ok(`${settingsSource}\n${settingsHookSource}`.includes(marker), `missing NodeRoute billing frontend marker ${marker}`);
  }
});
