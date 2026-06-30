const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');

function source(...parts) {
  return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

const vendorsRoute = source('backend', 'routes', 'vendors.js');
const arHubRoute = source('backend', 'routes', 'ar-hub.js');
const warehouseRoute = source('backend', 'routes', 'warehouse.js');
const inventoryRoute = source('backend', 'routes', 'inventory.js');
const purchasingRoute = source('backend', 'routes', 'ops', 'purchasing-order-routes.js');
const dailyBlastService = source('backend', 'services', 'daily-fish-blast.js');
const scheduler = source('backend', 'lib', 'scheduler.js');
const zodValidate = source('backend', 'lib', 'zod-validate.js');
const sprint4Migration = source('supabase', 'migrations', '20260517000400_sprint4_ledger_blast_security.sql');

test('vendor bills endpoint has validation, tenant checks, and receive-to-bill PO linkage', () => {
  for (const marker of [
    'const vendorBillBodySchema = z.object({',
    "router.post('/:id/bills'",
    'validateBody(vendorBillBodySchema)',
    'rowMatchesContext(vendor, req.context)',
    "scopeQueryByContext(supabase.from('purchase_orders').select('*'), req.context).eq('id', purchaseOrderId).single()",
    "insertRecordWithOptionalScope(supabase, 'vendor_bills'",
    'purchase_order_id: purchaseOrderId || null',
    'items,',
  ]) {
    assert.ok(vendorsRoute.includes(marker), `vendor bills missing marker ${marker}`);
  }

  for (const marker of [
    "router.post('/vendor-purchase-orders/:id/receive'",
    'receiptLines.push({',
    'qty_received: parseFloat(acceptedQty.toFixed(3))',
    'inventory_qty_after_receipt',
  ]) {
    assert.ok(purchasingRoute.includes(marker), `receive workflow missing marker ${marker}`);
  }
});

test('AR hub and warehouse routes keep tenant-aware access and ledger-backed adjustments', () => {
  for (const marker of [
    'filterRowsByContext(data || [], req.context)',
    'rowMatchesContext(existing, req.context)',
    'sendInvoiceEmail(inv, `Payment Reminder',
  ]) {
    assert.ok(arHubRoute.includes(marker), `AR hub missing marker ${marker}`);
  }

  for (const marker of [
    "select('id, item_number, description, on_hand_qty, unit, category, status, company_id, location_id')",
    'rowMatchesContext(existing, req.context)',
    'applyInventoryLedgerEntry({',
    "changeType: 'warehouse_count'",
    "insertRecordWithOptionalScope(supabase, 'warehouse_scans'",
    "insertRecordWithOptionalScope(supabase, 'warehouse_returns'",
  ]) {
    assert.ok(warehouseRoute.includes(marker), `warehouse route missing marker ${marker}`);
  }

  assert.ok(!warehouseRoute.includes('description, quantity, on_hand_qty'), 'warehouse summary should not select a non-existent quantity field');
});

test('daily fish blast is multi-tenant scoped and scheduler runs every company', () => {
  for (const marker of [
    'function applyScope(query, scope = {})',
    "query.eq('company_id', scope.companyId)",
    "query.eq('location_id', scope.locationId)",
    ".eq('change_type', 'restock')",
    'async function listBlastScopes',
    'fetchReceivedSinceCutoff(cutoff, scope)',
    'fetchEligibleCustomers(scope)',
    'runDailyFishBlastForAllCompanies',
  ]) {
    assert.ok(dailyBlastService.includes(marker), `daily blast missing marker ${marker}`);
  }

  assert.ok(scheduler.includes('runDailyFishBlastForAllCompanies(companyName)'));
});

test('legacy vendor PO route and old validator shim are removed from active code', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'backend', 'routes', 'ops-vendor-pos.js')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'backend', 'lib', 'zodValidate.js')), false);

  const routeSources = [
    source('backend', 'routes', 'orders.js'),
    source('backend', 'routes', 'invoices.js'),
  ].join('\n');
  assert.ok(routeSources.includes("require('../lib/zod-validate')"));
  assert.ok(!routeSources.includes("require('../lib/zodValidate')"));
  assert.ok(zodValidate.includes('function validate(schema, options)'));
});

test('inventory ledger history reads and database policy are tenant scoped', () => {
  for (const marker of [
    'filterRowsByContext(Array.isArray(data) ? data : [], req.context)',
    'filterRowsByContext(data || [], req.context)',
  ]) {
    assert.ok(inventoryRoute.includes(marker), `inventory route missing marker ${marker}`);
  }

  for (const marker of [
    'alter table public.inventory_stock_history enable row level security',
    'create policy "tenant scoped inventory stock history"',
    'company_id = public.jwt_company_id()',
    'location_id = public.jwt_location_id()',
    'grant select, insert, update, delete on public.inventory_stock_history to authenticated',
  ]) {
    assert.ok(sprint4Migration.includes(marker), `sprint4 migration missing marker ${marker}`);
  }
});
