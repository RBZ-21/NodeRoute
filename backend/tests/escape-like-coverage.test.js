'use strict';

// BE-005/BE-006 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: user-supplied values reached .ilike() unescaped at several
// call sites, so LIKE metacharacters (% _ \) acted as wildcards — e.g. a
// lot filter of "%" matched every lot, and an email containing "_" could
// match other addresses during portal customer resolution.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, 'backend', rel), 'utf8');

// Every file:pattern pair the scan flagged, post-fix.
const REQUIRED_ESCAPED_SITES = [
  ['routes/lots.js', ".ilike('lot_number', `%${escapeLike(lot)}%`)"],
  ['routes/lots.js', ".ilike('vendor_id', `%${escapeLike(vendor)}%`)"],
  ['routes/ar-hub.js', ".ilike('customer_name', `%${escapeLike(id)}%`)"],
  ['routes/ai.js', '.ilike(field, `%${escapeLike(term)}%`)'],
  ['routes/ops/purchasing-planning-routes.js', ".ilike('name', escapeLike(value))"],
  ['routes/portal/shared.js', ".ilike('customer_email', escapeLike(normalized))"],
  ['routes/portal/shared.js', ".ilike('billing_email', escapeLike(normalized))"],
  ['routes/portal/shared.js', ".ilike('email', escapeLike(normalized))"],
];

test('all scan-flagged .ilike() sites escape LIKE metacharacters', () => {
  for (const [file, marker] of REQUIRED_ESCAPED_SITES) {
    const source = read(file);
    assert.ok(source.includes(marker), `${file} missing escaped site: ${marker}`);
    assert.ok(source.includes("require('../lib/escape-like')") || source.includes("require('../../lib/escape-like')"),
      `${file} must import the shared escapeLike helper`);
  }
});

test('flagged files no longer interpolate raw user input into ilike patterns', () => {
  // The exact pre-fix patterns must not reappear.
  const BANNED = [
    ['routes/lots.js', '.ilike(\'lot_number\', `%${lot}%`)'],
    ['routes/lots.js', '.ilike(\'vendor_id\', `%${vendor}%`)'],
    ['routes/ar-hub.js', '.ilike(\'customer_name\', `%${id}%`)'],
    ['routes/ai.js', '.ilike(field, `%${term}%`)'],
    ['routes/ai.js', '.ilike(\'description\', `%${term}%`)'],
    ['routes/ops/purchasing-planning-routes.js', ".ilike('name', value)"],
    ['routes/portal/shared.js', ".ilike('customer_email', normalized)"],
    ['routes/portal/shared.js', ".ilike('billing_email', normalized)"],
  ];
  for (const [file, pattern] of BANNED) {
    assert.ok(!read(file).includes(pattern), `${file} reintroduced unescaped pattern: ${pattern}`);
  }
});

test('escapeLike neutralizes every LIKE metacharacter', () => {
  const { escapeLike } = require('../lib/escape-like');
  assert.equal(escapeLike('%'), '\\%');
  assert.equal(escapeLike('_'), '\\_');
  assert.equal(escapeLike('\\'), '\\\\');
  assert.equal(escapeLike('a_b%c\\d'), 'a\\_b\\%c\\\\d');
});
