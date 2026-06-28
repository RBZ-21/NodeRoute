'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const portalCheckoutSource = read('backend', 'routes', 'portal', 'payment-collection-routes.js');
const webhookSource = read('backend', 'routes', 'stripe-webhooks.js');
const safeErrorSource = read('backend', 'lib', 'safe-error.js');
const configSource = read('backend', 'lib', 'config.js');
const stopsSource = read('backend', 'routes', 'stops.js');
const deliveriesSource = read('backend', 'routes', 'deliveries.js');
const migrationSource = read('supabase', 'migrations', '20260625204708_harden_rls_rpc_portal_checkout.sql');
const driverStorageSource = read('driver-app', 'src', 'lib', 'storage.ts');
const offlineQueueSource = read('driver-app', 'src', 'hooks', 'useOfflineQueue.ts');
const driverAppSource = read('driver-app', 'src', 'hooks', 'useDriverApp.tsx');

test('portal checkout snapshots exact invoice set into Stripe metadata', () => {
  for (const marker of [
    "checkout_type: 'portal_checkout'",
    'const invoiceHash = hashInvoiceSet(balance.openInvoices)',
    'invoice_ids: invoiceIds',
    'invoice_hash: invoiceHash',
    'PORTAL_CHECKOUT_INVOICE_SET_TOO_LARGE',
  ]) {
    assert.ok(portalCheckoutSource.includes(marker), `missing portal checkout marker ${marker}`);
  }
});

test('Stripe webhook validates portal invoice set before marking paid', () => {
  for (const marker of [
    'parseInvoiceIds(invoice_ids)',
    ".ilike('customer_email', customer_email)",
    "recomputedHash !== invoice_hash",
    'portal_checkout: invoice hash mismatch',
    '.in(\'status\', Array.from(PAYABLE_INVOICE_STATUSES))',
  ]) {
    assert.ok(webhookSource.includes(marker), `missing webhook marker ${marker}`);
  }
});

test('Supabase migration stops trusting top-level JWT claims and locks definer RPC', () => {
  assert.ok(migrationSource.includes("auth.jwt() -> 'app_metadata' ->> 'company_id'"));
  assert.ok(!migrationSource.includes("auth.jwt() ->> 'company_id'"));
  assert.ok(migrationSource.includes('alter table if exists public.company_config enable row level security'));
  assert.ok(migrationSource.includes("policyname = 'Allow all for authenticated'"));
  assert.ok(migrationSource.includes('security definer'));
  assert.ok(migrationSource.includes('set search_path = public, pg_temp'));
  assert.ok(migrationSource.includes('revoke all on function public.sync_route_stop_assignments'));
  assert.ok(migrationSource.includes('grant execute on function public.sync_route_stop_assignments'));
});

test('route hardening covers safe errors, production config fatals, and driver authorization', () => {
  assert.ok(safeErrorSource.includes('function sendSafeError(req, res, err'));
  assert.ok(configSource.includes('isProduction ? fatal.concat(errors) : fatal'));
  assert.ok(stopsSource.includes("supabase.from('stops').select('id,driver_id,company_id,location_id')"));
  assert.ok(stopsSource.includes("req.user.role === 'driver' && String(existing.driver_id) !== String(req.user.id)"));
  assert.ok(deliveriesSource.includes("router.patch('/deliveries/:id/status', authenticateToken, requireRole('admin', 'manager', 'driver')"));
});

test('driver POD drafts store photos by IndexedDB reference instead of localStorage payloads', () => {
  assert.ok(driverStorageSource.includes('POD_DRAFT_PHOTO_DB_NAME'));
  assert.ok(driverStorageSource.includes('proofImage: null'));
  assert.ok(driverStorageSource.includes('proofImageDraftId'));
  assert.ok(offlineQueueSource.includes('sanitizePayloadForLocalStorage'));
  assert.ok(offlineQueueSource.includes('const { proofImage, ...safePayload } = payload'));
  assert.ok(driverAppSource.includes('proofImageDraftId'));
  assert.ok(driverAppSource.includes('loadPodDraftPhoto(proofImageDraftId)'));
});
