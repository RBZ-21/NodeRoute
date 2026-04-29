const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
function readSources(paths) {
  return paths.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
}

const portalRouteSource = readSources([
  path.join(repoRoot, 'backend', 'routes', 'portal.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal-payments.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'shared.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-profile-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-method-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'portal', 'payment-collection-routes.js'),
]);
const portalFrontendSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'customer-portal.html'), 'utf8');

test('portal backend exposes payment readiness endpoints', () => {
  for (const marker of [
    "router.get('/payments/config'",
    "router.get('/payments/profile'",
    "router.post('/payments/methods'",
    "router.post('/payments/setup-intent'",
    "router.patch('/payments/autopay'",
    "router.post('/payments/autopay/charge-now'",
    "router.post('/payments/create-checkout-session'",
    "router.post('/invoices/:id/pay'",
    'PORTAL_PAYMENT_ENABLED',
    'isStripeProviderEnabled',
    'PAYMENT_NOT_CONFIGURED',
    'AUTOPAY_METHOD_TYPES',
  ]) {
    assert.ok(portalRouteSource.includes(marker), `missing portal payments marker ${marker}`);
  }
});

test('customer portal frontend includes payment bootstrap and checkout trigger', () => {
  for (const marker of [
    'id="payModalPrimaryBtn"',
    'id="payModalStatus"',
    'loadPortalPaymentConfig()',
    'loadPaymentsProfile()',
    'initStripeSetupForm()',
    'savePaymentMethod()',
    'saveAutopaySettings()',
    'runAutopayNow()',
    'debit_card',
    'ach_bank',
    'startOnlinePayment()',
    "fetch(API + '/payments/config', ah())",
    "fetch(API + '/payments/profile', ah())",
    "fetch(API + '/payments/setup-intent', {",
    "fetch(API + '/payments/methods', {",
    "fetch(API + '/payments/autopay', {",
    "fetch(API + '/payments/create-checkout-session'",
    'https://js.stripe.com/v3/',
  ]) {
    assert.ok(portalFrontendSource.includes(marker), `missing customer portal payment marker ${marker}`);
  }
});
