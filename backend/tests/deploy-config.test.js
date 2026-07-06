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

// OPS-004: no Node pin existed outside CI — local, Railway, and CI could all
// build on different Node majors.
test('Node 20 is pinned consistently across CI, engines, nvmrc, and Nixpacks', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /node-version:\s*20/, 'CI must pin Node 20');

  for (const pkgPath of [
    'package.json',
    'backend/package.json',
    'frontend-v2/package.json',
    'landing-v2/package.json',
    'driver-app/package.json',
  ]) {
    const pkg = JSON.parse(read(pkgPath));
    assert.ok(pkg.engines && pkg.engines.node, `${pkgPath} must declare engines.node`);
    assert.match(pkg.engines.node, /(^|[^\d])20/, `${pkgPath} engines.node must pin the Node 20 line`);
  }

  assert.equal(read('.nvmrc').trim(), '20', '.nvmrc must pin Node 20');
  assert.match(read('nixpacks.toml'), /NIXPACKS_NODE_VERSION\s*=\s*"20"/, 'nixpacks.toml must pin Node 20');
});
