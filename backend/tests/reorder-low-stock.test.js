'use strict';
const fs   = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');

const inventoryRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'inventory.js'), 'utf8'
);
const vendorBillsRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'vendor-bills.js'), 'utf8'
);
const purchasingOrderRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-order-routes.js'), 'utf8'
);
const serverSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'server.js'), 'utf8'
);
const migrationSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260511_reorder_barcode_vendor_bills.sql'), 'utf8'
);
const writeSchemaSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'lib', 'inventory-write-schemas.js'), 'utf8'
);

// ── Migration ──────────────────────────────────────────────────────────────

test('migration adds reorder_point and barcode to products', () => {
  assert.ok(migrationSource.includes('reorder_point numeric'), 'reorder_point column missing from migration');
  assert.ok(migrationSource.includes('barcode text'), 'barcode column missing from migration');
});

test('migration creates low-stock index on products', () => {
  assert.ok(
    migrationSource.includes('products_low_stock_idx'),
    'products_low_stock_idx index missing'
  );
});

test('migration creates unique barcode index per company', () => {
  assert.ok(
    migrationSource.includes('products_barcode_company_idx'),
    'products_barcode_company_idx unique index missing'
  );
});

test('migration creates vendor_bills table', () => {
  assert.ok(migrationSource.includes('CREATE TABLE IF NOT EXISTS vendor_bills'), 'vendor_bills table missing');
  assert.ok(
    migrationSource.includes("DEFAULT 'pending'"),
    'vendor_bills status default pending missing'
  );
  assert.ok(migrationSource.includes('auto_generated'), 'auto_generated column missing');
});

test('migration enables RLS on vendor_bills', () => {
  assert.ok(
    migrationSource.includes('ALTER TABLE vendor_bills ENABLE ROW LEVEL SECURITY'),
    'RLS not enabled on vendor_bills'
  );
  assert.ok(
    migrationSource.includes('vendor_bills_admin_manager'),
    'RLS policy vendor_bills_admin_manager missing'
  );
});

// ── Write schemas ──────────────────────────────────────────────────────────

test('inventory product patch schema accepts reorder_point', () => {
  assert.ok(
    writeSchemaSource.includes('reorder_point'),
    'reorder_point missing from inventoryProductPatchBodySchema'
  );
});

test('inventory product patch schema accepts barcode', () => {
  assert.ok(
    writeSchemaSource.includes('barcode'),
    'barcode missing from inventoryProductPatchBodySchema'
  );
});

// ── Low-stock route ────────────────────────────────────────────────────────

test('inventory route exposes GET /low-stock endpoint', () => {
  assert.ok(
    inventoryRouteSource.includes("router.get('/low-stock'"),
    "GET /low-stock route missing from inventory.js"
  );
});

test('/low-stock route filters by reorder_point > 0', () => {
  assert.ok(
    inventoryRouteSource.includes("gt('reorder_point', 0)") ||
    inventoryRouteSource.includes(".gt('reorder_point'"),
    '/low-stock does not filter by reorder_point > 0'
  );
});

test('/low-stock route includes deficit calculation', () => {
  assert.ok(
    inventoryRouteSource.includes('deficit'),
    '/low-stock does not compute deficit field'
  );
});

// ── Vendor bills route ─────────────────────────────────────────────────────

test('vendor-bills route exposes GET /', () => {
  assert.ok(vendorBillsRouteSource.includes("router.get('/'"), "GET / missing from vendor-bills.js");
});

test('vendor-bills route exposes GET /:id', () => {
  assert.ok(vendorBillsRouteSource.includes("router.get('/:id'"), "GET /:id missing from vendor-bills.js");
});

test('vendor-bills route exposes PATCH /:id', () => {
  assert.ok(vendorBillsRouteSource.includes("router.patch('/:id'"), "PATCH /:id missing from vendor-bills.js");
});

test('vendor-bills PATCH validates allowed statuses', () => {
  assert.ok(
    vendorBillsRouteSource.includes('VALID_STATUSES'),
    'PATCH /:id does not validate status values'
  );
  for (const s of ['pending', 'approved', 'paid', 'void']) {
    assert.ok(vendorBillsRouteSource.includes(`'${s}'`), `status '${s}' missing from validation set`);
  }
});

test('vendor-bills PATCH auto-sets paid_at when transitioning to paid', () => {
  assert.ok(
    vendorBillsRouteSource.includes("fields.status === 'paid'") &&
    vendorBillsRouteSource.includes('paid_at'),
    'PATCH does not auto-set paid_at on paid transition'
  );
});

// ── Server registration ────────────────────────────────────────────────────

test('server.js registers vendor-bills route', () => {
  assert.ok(
    serverSource.includes("require('./routes/vendor-bills')"),
    'vendor-bills router not required in server.js'
  );
  assert.ok(
    serverSource.includes("'/api/vendor-bills'"),
    '/api/vendor-bills mount path missing from server.js'
  );
});

// ── Auto-bill on full PO receive ───────────────────────────────────────────

test('purchasing-order-routes inserts vendor bill on full receipt', () => {
  assert.ok(
    purchasingOrderRouteSource.includes("from('vendor_bills').insert"),
    'auto-bill insert missing from purchasing-order-routes.js'
  );
});

test('auto-bill uses auto_generated flag', () => {
  assert.ok(
    purchasingOrderRouteSource.includes('auto_generated'),
    'auto_generated flag missing from auto-bill insert'
  );
});

test('auto-bill is non-fatal (wrapped in try/catch)', () => {
  assert.ok(
    purchasingOrderRouteSource.includes('[auto-bill]') ||
    purchasingOrderRouteSource.includes('billErr'),
    'auto-bill error handling (non-fatal try/catch) missing'
  );
});
