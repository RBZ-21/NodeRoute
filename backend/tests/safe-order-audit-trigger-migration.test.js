const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260518201246_safe_order_audit_trigger.sql'),
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
