const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const migration = read('supabase', 'migrations', '20260517000300_sprint2_warehouse_security.sql');
const warehouseRoute = read('backend', 'routes', 'warehouse.js');
const vendorRoute = read('backend', 'routes', 'vendors.js');
const ledgerService = read('backend', 'services', 'inventory-ledger.js');

test('sprint 2 migration creates warehouse and vendor bill tables', () => {
  for (const marker of [
    'create table if not exists public.warehouse_locations',
    'create table if not exists public.warehouse_scans',
    'create table if not exists public.warehouse_returns',
    'create table if not exists public.vendor_bills',
  ]) {
    assert.ok(migration.includes(marker), `missing migration marker: ${marker}`);
  }
});

test('sprint 2 migration hardens legacy RLS targets', () => {
  for (const marker of [
    'alter table if exists public.lot_codes enable row level security',
    'alter table if exists public."Customers" enable row level security',
    'alter table if exists public.dwell_records enable row level security',
    'create policy "tenant scoped lot codes"',
    'create policy "tenant scoped customers"',
    'create policy "tenant scoped dwell records"',
  ]) {
    assert.ok(migration.includes(marker), `missing RLS marker: ${marker}`);
  }
});

test('warehouse inventory patch posts through the inventory ledger', () => {
  assert.ok(warehouseRoute.includes("changeType: 'warehouse_count'"));
  assert.ok(warehouseRoute.includes('setAbsoluteQty: nextQty'));
  assert.ok(warehouseRoute.includes('context: req.context'));
  assert.ok(!warehouseRoute.includes("const ALLOWED = ['quantity', 'status', 'cost', 'description'];"));
});

test('vendor bills POST endpoint is implemented and tenant scoped', () => {
  assert.ok(vendorRoute.includes("router.post('/:id/bills'"));
  assert.ok(vendorRoute.includes("insertRecordWithOptionalScope(supabase, 'vendor_bills'"));
  assert.ok(vendorRoute.includes('rowMatchesContext(vendor, req.context)'));
  assert.ok(vendorRoute.includes('rowMatchesContext(po, req.context)'));
});

test('inventory ledger accepts request context for scoped stock updates', () => {
  assert.ok(ledgerService.includes('function scopeQuery(query, context)'));
  assert.ok(ledgerService.includes('async function fetchInventoryByItemNumber(itemNumber, context = null)'));
  assert.ok(ledgerService.includes('context = null'));
  assert.ok(ledgerService.includes('...buildScopeFields(context || {}'));
});
