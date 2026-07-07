'use strict';

// DB-012 regression test (Root Depth Scan, commit 904d7119).
// Original bug: orders.invoice_id and invoices.order_id were plain columns
// with no FK in either direction (orders.invoice_id was text; the
// invoices.order_id FK existed only out-of-band in production).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot, 'supabase', 'migrations', '20260706120000_orders_invoices_fk.sql'
);

test('DB-012 migration adds FKs both directions with orphan guard before cast', () => {
  assert.ok(fs.existsSync(migrationPath), 'DB-012 migration missing');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Orphan/garbage nulling must precede the uuid cast.
  const guardIdx = sql.indexOf('set invoice_id = null');
  const castIdx = sql.indexOf('alter column invoice_id type uuid');
  assert.ok(guardIdx >= 0, 'orphan/non-uuid guard missing');
  assert.ok(castIdx >= 0, 'uuid conversion missing');
  assert.ok(guardIdx < castIdx, 'guard must run before the type conversion');

  // Real FKs, both directions, idempotent.
  assert.ok(sql.includes('orders_invoice_id_fkey'));
  assert.ok(sql.includes('references public.invoices(id) on delete set null'));
  assert.ok(sql.includes('invoices_order_id_fkey'));
  assert.ok(sql.includes('references public.orders(id) on delete set null'));
  assert.ok((sql.match(/if not exists \(\s*select 1 from pg_constraint/gi) || []).length >= 1,
    'constraint creation must be guarded for idempotency');
});
