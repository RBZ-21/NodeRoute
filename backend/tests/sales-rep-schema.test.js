const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');

function source(...parts) {
  return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

const salesRepRoute = source('backend', 'routes', 'sales-reps.js');
const crmMigration = source('supabase', 'migrations', '20260504_crm_ar_hub.sql');
const forecastMigration = source('supabase', 'migrations', '20260518_sales_rep_forecast_items.sql');

test('Sales Rep Hub tables and columns are backed by migrations', () => {
  for (const marker of [
    'ADD COLUMN IF NOT EXISTS sales_rep_id',
    'CREATE TABLE IF NOT EXISTS customer_visit_logs',
    'sales_rep_id    UUID REFERENCES users(id) ON DELETE SET NULL',
  ]) {
    assert.ok(crmMigration.includes(marker), `CRM migration missing marker ${marker}`);
  }

  for (const marker of [
    'create table if not exists public.forecast_items',
    'species text not null',
    'projected_demand numeric not null default 0',
    'alter table public.forecast_items enable row level security',
    'create policy "forecast_items: tenant scoped"',
  ]) {
    assert.ok(forecastMigration.includes(marker), `forecast migration missing marker ${marker}`);
  }
});

test('Sales Rep Hub route queries the migrated tables', () => {
  for (const marker of [
    ".from('Customers')",
    ".from('customer_visit_logs')",
    ".from('forecast_items')",
    ".from('orders')",
    ".select('species,projected_demand,unit')",
  ]) {
    assert.ok(salesRepRoute.includes(marker), `sales rep route missing marker ${marker}`);
  }
});
