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
const reactSrcDir = path.join(repoRoot, 'frontend-v2', 'src');
const portalFrontendSource = [
  path.join(reactSrcDir, 'hooks', 'usePortalData.ts'),
  path.join(reactSrcDir, 'pages', 'PortalTabViews.tsx'),
  path.join(reactSrcDir, 'pages', 'portal.types.ts'),
].map((f) => fs.readFileSync(f, 'utf8')).join('\n');

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
    '/api/portal/payments/config',
    '/api/portal/payments/profile',
    '/api/portal/payments/create-checkout-session',
    '/api/portal/payments/autopay/charge-now',
    'ach_bank',
    'autopay',
  ]) {
    assert.ok(portalFrontendSource.includes(marker), `missing customer portal payment marker ${marker}`);
  }
});
