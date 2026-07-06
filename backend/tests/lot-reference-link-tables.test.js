'use strict';

// DB-005 regression tests (Root Depth Scan, commit 904d7119 — FSMA 204).
// Original bug: lot references lived only as free-text JSONB with no FKs,
// and two competing lot tables (lot_codes vs inventory_lots) modeled the
// same concept. Fix: lot_codes is canonical; normalized link tables with
// real FKs are backfilled from the JSONB and kept in sync by triggers.
// The JSONB fields are retained for existing readers (owner-approved scope);
// dropping them is a tracked follow-up once readers migrate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot, 'supabase', 'migrations', '20260706100000_lot_reference_link_tables.sql'
);

test('lot link-table migration exists with real FKs to canonical lot_codes', () => {
  assert.ok(fs.existsSync(migrationPath), 'DB-005 migration missing');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Canonical table choice: every lot FK points at lot_codes, not inventory_lots.
  const lotFkCount = (sql.match(/references public\.lot_codes\(id\)/g) || []).length;
  assert.equal(lotFkCount, 3, 'all three link tables must FK to lot_codes');
  assert.ok(!sql.includes('references public.inventory_lots'), 'inventory_lots must not be the FK target');

  // Real FKs to the parent documents.
  assert.ok(sql.includes('references public.orders(id) on delete cascade'));
  assert.ok(sql.includes('references public.purchase_orders(id) on delete cascade'));
  assert.ok(sql.includes('references public.stops(id) on delete cascade'));

  // Backfill from the legacy JSONB shapes.
  assert.ok(sql.includes("'lot_number'"), 'backfill must read lot_number from JSONB');
  assert.ok(sql.includes("'quantity_from_lot'"), 'order backfill must read quantity_from_lot');
  assert.ok(sql.includes("'product_id'"), 'stop backfill must read product_id');
  assert.ok(/for r in select id, items, company_id from orders/.test(sql), 'orders backfill loop missing');
  assert.ok(/from purchase_orders/.test(sql), 'purchase_orders backfill missing');
  assert.ok(/from stops/.test(sql), 'stops backfill missing');

  // Sync triggers keep link tables current until the JSONB fields are dropped.
  for (const trigger of ['trg_sync_order_item_lots', 'trg_sync_po_item_lots', 'trg_sync_stop_shipped_lots']) {
    assert.ok(sql.includes(trigger), `${trigger} missing`);
  }

  // Guarded casts: malformed legacy JSON must not abort parent writes.
  assert.ok(sql.includes("~ '^-?[0-9]+(\\.[0-9]+)?$'"), 'numeric casts must be regex-guarded');
  assert.ok(sql.includes("~ '^[0-9]+$'"), 'lot_id int cast must be regex-guarded');

  // RLS: strict tenant match, no IS NULL fail-open (DB-010 pattern ban).
  assert.ok(sql.includes('company_id = public.jwt_company_id()'));
  assert.ok(!/company_id is null or/i.test(sql), 'no IS NULL OR fail-open in new policies');

  // The JSONB fields must NOT be dropped in this migration (approved scope).
  assert.ok(!/drop column/i.test(sql), 'JSONB fields must be retained for existing readers');
});
