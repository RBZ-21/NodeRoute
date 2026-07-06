'use strict';

// BE-008 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: ai.js queried a lowercase 'customers' table that does not
// exist (only mixed-case "Customers" does), and runOptionalScopedQuery
// swallowed the resulting error identically to a legitimate empty result —
// so AI chat context silently lost all customer data.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const aiSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ai.js'), 'utf8');

test('ai.js never queries the nonexistent lowercase customers table', () => {
  assert.ok(!aiSource.includes(".from('customers')"), "ai.js must query \"Customers\", not 'customers'");
  assert.ok(!aiSource.includes("table: 'customers'"), 'searchTableByTerms must target "Customers"');
  assert.ok(aiSource.includes(".from('Customers')"), 'ai.js must query the real "Customers" table');
  assert.ok(aiSource.includes("table: 'Customers'"), 'searchTableByTerms must use the real table name');
});

test('runOptionalScopedQuery logs unexpected errors instead of swallowing them silently', () => {
  const fnStart = aiSource.indexOf('async function runOptionalScopedQuery');
  assert.ok(fnStart >= 0, 'runOptionalScopedQuery missing');
  const fnEnd = aiSource.indexOf('\nasync function', fnStart + 10);
  const fn = aiSource.slice(fnStart, fnEnd);

  assert.ok(fn.includes('logger.warn'), 'query errors must be logged, not silently dropped');
  assert.ok(
    !/if \(error\) return \[\];/.test(fn),
    'error branch must not return empty silently'
  );
  assert.ok(
    !/catch\s*\{\s*return \[\];\s*\}/.test(fn),
    'catch branch must not return empty silently'
  );
});
