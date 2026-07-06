'use strict';

// OPS-003 regression test (Root Depth Scan, commit 904d7119).
// Original bug: railway.toml had no healthcheckPath despite /healthz
// existing in backend/server.js — Railway routed traffic to instances
// before the app was actually serving.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('railway deploy config health-checks the existing /healthz endpoint', () => {
  const railway = read('railway.toml');
  assert.match(railway, /healthcheckPath\s*=\s*"\/healthz"/, 'railway.toml must set healthcheckPath');
  assert.match(read('backend/server.js'), /app\.get\('\/healthz'/, '/healthz endpoint must exist');
});
