'use strict';

// OPS-001 regression test (Root Depth Scan, commit 904d7119).
// Original bug: .env.example carried two full copies of ~34 variables from
// two unmerged historical PRs, so editors updating one block silently left
// the other stale.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

test('.env.example declares every variable exactly once', () => {
  const content = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  const names = content
    .split('\n')
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/))
    .filter(Boolean)
    .map((match) => match[1]);

  const seen = new Set();
  const duplicates = new Set();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }

  assert.deepEqual(
    [...duplicates].sort(),
    [],
    `.env.example must not declare variables twice: ${[...duplicates].join(', ')}`
  );

  // Sanity: the unique sections from the formerly-second block survived dedup.
  for (const kept of ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD', 'BLAND_WEBHOOK_SECRET', 'STAFF_PHONE', 'TWILIO_NUMBER']) {
    assert.ok(seen.has(kept), `${kept} must survive the dedup`);
  }
});
