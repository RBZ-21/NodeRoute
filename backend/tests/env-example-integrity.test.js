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
  // (TWILIO_NUMBER was later removed by OPS-005 as a dead alias.)
  for (const kept of ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD', 'BLAND_WEBHOOK_SECRET', 'STAFF_PHONE']) {
    assert.ok(seen.has(kept), `${kept} must survive the dedup`);
  }
});

// OPS-005 regression (Root Depth Scan): 21+ env vars were used in code but
// undeclared in .env.example, and ~10 declared vars were dead. This scans
// every process.env / import.meta.env reference and asserts each is declared.
test('.env.example declares every env var the code actually reads', () => {
  const declared = new Set(
    fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8')
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/))
      .filter(Boolean)
      .map((match) => match[1])
  );

  // Runtime/tooling builtins that never belong in .env.example.
  const BUILTIN = new Set(['NODE_ENV', 'CI', 'DEV', 'MODE', 'PROD', 'SSR', 'HOME', 'PATH']);

  const used = new Set();
  const pattern = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|import\.meta\.env\.([A-Z][A-Z0-9_]*)/g;
  const roots = [
    'backend/routes', 'backend/services', 'backend/lib', 'backend/middleware',
    'backend/scripts', 'scripts', 'frontend-v2/src', 'landing-v2/src', 'driver-app/src',
  ];
  const scanFile = (filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(pattern)) {
      used.add(match[1] || match[2] || match[3]);
    }
  };
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'build', 'data'].includes(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (/\.(js|ts|tsx|mjs|cjs)$/.test(entry.name)) {
        scanFile(path.join(dir, entry.name));
      }
    }
  };
  for (const root of roots) {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  scanFile(path.join(repoRoot, 'backend', 'server.js'));

  const undeclared = [...used].filter((name) => !declared.has(name) && !BUILTIN.has(name)).sort();
  assert.deepEqual(undeclared, [], `env vars used in code but missing from .env.example: ${undeclared.join(', ')}`);
});
