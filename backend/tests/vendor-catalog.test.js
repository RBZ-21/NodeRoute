const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const vendorsRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'vendors.js'),
  'utf8'
);
const migrationSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260509_vendor_catalog_item_numbers.sql'),
  'utf8'
);

test('vendor catalog migration adds scoped item-number support', () => {
  assert.match(migrationSource, /add column if not exists catalog_item_numbers text\[\]/i);
  assert.match(migrationSource, /default '\{\}'::text\[\]/i);
});

test('vendors route accepts and normalizes catalog item numbers', () => {
  assert.match(vendorsRouteSource, /'catalog_item_numbers'/);
  assert.match(vendorsRouteSource, /function normalizeCatalogItemNumbers/);
  assert.match(vendorsRouteSource, /field === 'catalog_item_numbers'/);
  assert.match(vendorsRouteSource, /payload\[field\] = normalizeCatalogItemNumbers\(source\[field\]\)/);
});
