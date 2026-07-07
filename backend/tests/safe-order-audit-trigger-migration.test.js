const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260518201246_safe_order_audit_trigger.sql'),
  'utf8',
);
const scopeTypeMigration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260604201715_fix_audit_log_scope_types.sql'),
  'utf8',
);
const totalColumnMigration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260706212500_db013_order_audit_total_column.sql'),
  'utf8',
);

test('safe order audit trigger does not directly reference optional NEW customer fields', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION fn_audit_log_order_change/);
  assert.doesNotMatch(migration, /NEW\.customer_id/);
  assert.doesNotMatch(migration, /OLD\.customer_id/);
  assert.match(migration, /to_jsonb\(NEW\)/);
  assert.match(migration, /v_new ->> 'customer_id'/);
});

test('safe order audit trigger tolerates non-numeric or missing customer ids', () => {
  assert.match(migration, /~ '\^\[0-9\]\+\$'/);
  assert.match(migration, /ELSE NULL/);
});

test('audit log scope migration stores company and location ids as text', () => {
  assert.match(scopeTypeMigration, /ALTER COLUMN company_id TYPE text USING company_id::text/i);
  assert.match(scopeTypeMigration, /ALTER COLUMN location_id TYPE text USING location_id::text/i);
  assert.match(scopeTypeMigration, /v_company_id text/i);
  assert.match(scopeTypeMigration, /v_location_id text/i);
});

test('order audit total column migration uses the canonical total key', () => {
  assert.match(totalColumnMigration, /CREATE OR REPLACE FUNCTION public\.fn_audit_log_order_change\(\)/i);
  assert.match(totalColumnMigration, /SET search_path = public, pg_temp/i);
  assert.match(totalColumnMigration, /'total', v_new ->> 'total'/i);
  assert.match(totalColumnMigration, /'total', v_old ->> 'total'/i);
  assert.doesNotMatch(totalColumnMigration, /v_(new|old) ->> 'total_amount'/i);
});
