'use strict';

// DB-003 regression test (Root Depth Scan, commit 904d7119).
// Original bug: two migrations added orders.stop_id with conflicting types —
// 20260519000300 (uuid + FK to stops) and 20260527 (plain TEXT, no FK). With
// ADD COLUMN IF NOT EXISTS, whichever ran first silently won, so the live
// type depended on migration application history.
//
// Note: the scan also cited a test asserting the column type from migration
// source text; no such test exists for orders.stop_id at fix time (the only
// similar assertion targets temperature_logs, a different table). This test
// guards the schema definition instead: exactly one migration may define
// orders.stop_id, and it must be the uuid + FK variant. Verifying the LIVE
// column type requires a live database — see the information_schema query in
// the comment below for the production check.
//
//   select data_type from information_schema.columns
//   where table_schema = 'public' and table_name = 'orders'
//     and column_name = 'stop_id';   -- expect: uuid

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

test('exactly one migration defines orders.stop_id, and it is uuid + FK', () => {
  const defining = [];
  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').toLowerCase();
    // Match "alter table ... orders ... add column [if not exists] stop_id"
    if (/alter table (public\.)?orders[\s\S]{0,200}add column (if not exists )?stop_id/.test(sql)) {
      defining.push({ file, sql });
    }
  }

  assert.equal(
    defining.length, 1,
    `orders.stop_id must be defined by exactly one migration, found: ${defining.map((d) => d.file).join(', ')}`
  );

  const [{ file, sql }] = defining;
  assert.ok(
    /stop_id uuid references (public\.)?stops\(id\)/.test(sql),
    `${file} must define stop_id as uuid with an FK to stops(id)`
  );
  assert.ok(
    !/stop_id text/.test(sql),
    `${file} must not define stop_id as TEXT`
  );

  // The removed TEXT-variant migration must not come back.
  assert.ok(
    !fs.existsSync(path.join(migrationsDir, '20260527_orders_stop_id.sql')),
    'conflicting TEXT-variant migration 20260527_orders_stop_id.sql must stay removed'
  );
});
