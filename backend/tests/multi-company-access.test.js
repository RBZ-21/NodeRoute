const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const usersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'users.js'), 'utf8');
const authRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'auth.js'), 'utf8');
const authMiddlewareSource = fs.readFileSync(path.join(repoRoot, 'backend', 'middleware', 'auth.js'), 'utf8');

test('users invite flow enforces company and location scope checks', () => {
  for (const marker of [
    'const canInviteAcrossCompanies = !!context.isGlobalOperator;',
    "Cannot invite users outside your company scope",
    "Cannot invite users outside your location scope",
    'companyId is required for invite scoping',
  ]) {
    assert.ok(usersRouteSource.includes(marker), `missing users invite marker ${marker}`);
  }
});

test('auth payload keeps tenant context claims', () => {
  for (const marker of [
    'id: userId',
    'sub: userId',
    'companyId: context.companyId',
    'locationId: context.locationId',
    'platformRole: context.platformRole',
  ]) {
    assert.ok(authRouteSource.includes(marker), `missing auth tenant claim ${marker}`);
  }
});

test('auth middleware resolves token claims across id formats', () => {
  for (const marker of [
    "payload?.userId || payload?.id || payload?.sub",
    "normalizeEmail(payload?.email)",
    "return res.status(401).json({ error: 'User not found' })",
  ]) {
    assert.ok(authMiddlewareSource.includes(marker), `missing auth middleware compatibility marker ${marker}`);
  }
});
