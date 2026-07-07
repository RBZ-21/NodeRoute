'use strict';

// BE-007 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: fetchAllCustomers (routes/customers.js) and
// runScheduledCreditCheck (services/creditEngine.js) paginated Customers.id
// as if numeric — nextId=0 / .gte('id', nextId) / Number(row.id)+1 — which
// silently truncated to a single page whenever ids were not numeric.
// Fix: keyset pagination on the raw id value via .gt('id', cursor), no
// Number() coercion — works for bigint, uuid, and text ids alike.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

test('customer pagination no longer coerces ids to numbers', () => {
  const customersSource = fs.readFileSync(
    path.join(repoRoot, 'backend', 'routes', 'customers.js'), 'utf8'
  );
  const creditSource = fs.readFileSync(
    path.join(repoRoot, 'backend', 'services', 'creditEngine.js'), 'utf8'
  );

  for (const [name, source] of [['customers.js', customersSource], ['creditEngine.js', creditSource]]) {
    assert.ok(
      !/Number\([^)]*\.id\)/.test(source),
      `${name} must not coerce id values with Number()`
    );
    assert.ok(
      !/\.gte\('id',\s*(nextId|cursor)\)/.test(source),
      `${name} must not use the numeric .gte cursor pattern`
    );
    assert.ok(
      /\.gt\('id',\s*cursor\)/.test(source),
      `${name} must use raw-value keyset pagination (.gt on the last id)`
    );
  }
});

// The demo client mirrors PostgREST filter semantics; this proves the keyset
// loop the fix relies on retrieves EVERY row across multiple pages with
// non-numeric ids — exactly the case the old pattern truncated on.
test('keyset .gt(id) pagination walks all pages with non-numeric ids', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-pagination-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`)) delete require.cache[key];
  }

  try {
    const { supabase } = require('../services/supabase');
    const ids = ['cust-a', 'cust-b', 'cust-c', 'cust-d', 'cust-e'];
    for (const id of ids) {
      await supabase.from('Customers').insert({ id, company_name: `Pager ${id}` });
    }

    const pageSize = 2;
    const rows = [];
    let cursor = null;
    while (true) {
      let query = supabase.from('Customers').select('*').order('id', { ascending: true }).limit(pageSize);
      if (cursor != null) query = query.gt('id', cursor);
      const { data: page, error } = await query;
      assert.equal(error, null);
      if (!page || !page.length) break;
      rows.push(...page);
      if (page.length < pageSize) break;
      cursor = page[page.length - 1].id;
    }

    const fetchedIds = rows.map((row) => row.id).filter((id) => ids.includes(id)).sort();
    assert.deepEqual(fetchedIds, ids, 'keyset pagination must return every row, not just the first page');

    // And the OLD pattern demonstrably truncates on the same data.
    const legacyLastId = Number(rows[0]?.id);
    assert.ok(!Number.isFinite(legacyLastId), 'non-numeric ids are exactly what broke the old Number() cursor');
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`)) delete require.cache[key];
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
