'use strict';

// DB-004 regression tests (Root Depth Scan, commit 904d7119 — FSMA 204).
// Original bug: audit_log, route_mutation_audit_logs, lot_codes, and
// inventory_lots had no append-only protection — audit history and lot
// receiving records could be updated or deleted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot, 'supabase', 'migrations', '20260705120000_append_only_audit_traceability.sql'
);
const creditHoldPatternPath = path.join(
  repoRoot, 'supabase', 'migrations', '20260518000200_credit_hold_system.sql'
);

test('append-only migration exists and mirrors the credit_hold_log pattern', () => {
  assert.ok(fs.existsSync(migrationPath), 'DB-004 migration missing');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const referenceSql = fs.readFileSync(creditHoldPatternPath, 'utf8');

  // The reference pattern this migration is required to mirror.
  assert.ok(referenceSql.includes('BEFORE UPDATE OR DELETE ON credit_hold_log'));

  // Pure log tables: full append-only, same trigger shape as credit_hold_log.
  for (const table of ['audit_log', 'route_mutation_audit_logs']) {
    assert.ok(
      sql.includes(`BEFORE UPDATE OR DELETE ON ${table}`),
      `${table} must have a BEFORE UPDATE OR DELETE trigger`
    );
    assert.ok(
      sql.includes(`${table} is append-only`),
      `${table} trigger must RAISE EXCEPTION on mutation`
    );
    assert.ok(
      sql.includes(`REVOKE UPDATE, DELETE ON ${table}`),
      `${table} must revoke UPDATE/DELETE grants`
    );
  }

  // Traceability tables: DELETE blocked, identity columns immutable, but
  // operational columns (qty_on_hand, status, PO link) stay writable so lot
  // depletion / kits / PATCH lots keep working.
  for (const table of ['lot_codes', 'inventory_lots']) {
    assert.ok(
      sql.includes(`BEFORE UPDATE OR DELETE ON ${table}`),
      `${table} must have a protection trigger`
    );
    assert.ok(
      sql.includes(`${table} rows cannot be deleted`),
      `${table} trigger must block DELETE`
    );
    assert.ok(
      sql.match(new RegExp(`${table} identity/receiving fields are immutable`)),
      `${table} trigger must block identity-column updates`
    );
  }

  // Immutable column guards present.
  assert.ok(sql.includes('NEW.lot_number') && sql.includes('IS DISTINCT FROM OLD.lot_number'));
  assert.ok(sql.includes('IS DISTINCT FROM OLD.qty_received'));
  assert.ok(sql.includes('IS DISTINCT FROM OLD.quantity_received'));
  assert.ok(sql.includes('IS DISTINCT FROM OLD.company_id'));

  // qty_on_hand / status must NOT be in the immutable guard — depletion
  // workflows rely on updating them.
  assert.ok(!sql.includes('IS DISTINCT FROM OLD.qty_on_hand'), 'qty_on_hand must remain mutable');
  assert.ok(!sql.includes('IS DISTINCT FROM OLD.status'), 'status must remain mutable');
});

test('lot DELETE route maps the trigger block to a 409 with guidance', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'backend', 'routes', 'inventory.js'), 'utf8'
  );
  assert.ok(source.includes('LOT_DELETE_PROTECTED'), 'delete route must return LOT_DELETE_PROTECTED');
  assert.ok(
    /cannot be deleted[\s\S]{0,400}status\(409\)|status\(409\)[\s\S]{0,400}cannot be deleted/.test(source),
    'delete route must return 409 when the DB blocks lot deletion'
  );
});
