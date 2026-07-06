'use strict';

// DB-010 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: RLS policies on customer_visit_logs and sms_blast_log used
// "company_id IS NULL OR company_id = auth_company_id()", letting any tenant
// read/write NULL-tenant rows (and insert new NULL-tenant rows).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const fixMigrationPath = path.join(migrationsDir, '20260706110000_rls_remove_null_tenant_failopen.sql');

test('DB-010 migration backfills NULL rows BEFORE tightening the policies', () => {
  assert.ok(fs.existsSync(fixMigrationPath), 'DB-010 migration missing');
  const sql = fs.readFileSync(fixMigrationPath, 'utf8');

  for (const table of ['customer_visit_logs', 'sms_blast_log']) {
    const backfillIdx = sql.indexOf(`update public.${table}`);
    const policyIdx = sql.indexOf(`create policy "${table}: tenant scoped"`);
    assert.ok(backfillIdx >= 0, `${table} NULL-row backfill missing`);
    assert.ok(policyIdx >= 0, `${table} tightened policy missing`);
    assert.ok(backfillIdx < policyIdx, `${table}: backfill must run before the policy is tightened`);
  }

  // The recreated policies must be strict equality — no IS NULL disjunct.
  const policyBodies = sql.slice(sql.indexOf('create policy'));
  assert.ok(!/company_id is null\s+or/i.test(policyBodies), 'tightened policies must not contain "company_id IS NULL OR"');
  assert.ok(policyBodies.includes('using (company_id = public.auth_company_id())'));
  assert.ok(policyBodies.includes('with check (company_id = public.auth_company_id())'));
});

test('no LATER migration reintroduces the NULL-tenant fail-open on these tables', () => {
  const fixName = path.basename(fixMigrationPath);
  const offenders = [];
  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith('.sql') || file <= fixName) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const table of ['customer_visit_logs', 'sms_blast_log']) {
      if (sql.includes(table) && /company_id is null\s+or/i.test(sql)) {
        offenders.push(`${file} (${table})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `fail-open pattern reintroduced by: ${offenders.join(', ')}`);
});
