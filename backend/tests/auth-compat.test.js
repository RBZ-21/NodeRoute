const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) || key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`)) {
      delete require.cache[key];
    }
  }
}

test('authenticateToken accepts legacy email-only token claims when user id lookup misses', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-auth-compat-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  const { supabase } = require('../services/supabase');
  const { authenticateToken } = require('../middleware/auth');
  const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

  await supabase.from('users').insert({
    id: 'user-current-001',
    name: 'Current Admin',
    email: 'current.admin@noderoute.test',
    role: 'admin',
    status: 'active',
    company_id: 'company-a',
    location_id: 'loc-a',
  });

  const token = jwt.sign(
    {
      sub: 'legacy-missing-id',
      email: 'current.admin@noderoute.test',
      role: 'admin',
    },
    jwtSecret,
    { expiresIn: '1h' }
  );

  const req = { cookies: { token }, headers: {} };
  let statusCode = 0;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      throw new Error(`Unexpected auth failure ${statusCode}: ${JSON.stringify(payload)}`);
    },
  };

  await authenticateToken(req, res, () => {});

  assert.equal(req.user.id, 'user-current-001');
  assert.equal(req.user.email, 'current.admin@noderoute.test');
  assert.ok(req.context);
  assert.equal(req.context.activeCompanyId, 'company-a');
  assert.equal(req.context.activeLocationId, 'loc-a');

  if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
  else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
  if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
  else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
  clearBackendModuleCache();
  fs.rmSync(backupPath, { recursive: true, force: true });
});

test('authenticateToken rejects non-global users without a resolved tenant context', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-auth-tenant-context-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  const { supabase } = require('../services/supabase');
  const { authenticateToken } = require('../middleware/auth');
  const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

  await supabase.from('users').insert({
    id: 'tenantless-admin-001',
    name: 'Tenantless Admin',
    email: 'tenantless.admin@noderoute.test',
    role: 'admin',
    status: 'active',
  });

  const token = jwt.sign(
    {
      sub: 'tenantless-admin-001',
      email: 'tenantless.admin@noderoute.test',
      role: 'admin',
    },
    jwtSecret,
    { expiresIn: '1h' }
  );

  const req = { cookies: {}, headers: { authorization: `Bearer ${token}` }, path: '/orders', method: 'GET' };
  let statusCode = 0;
  let payload = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };
  let nextCalled = false;

  await authenticateToken(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(payload, { error: 'Tenant context required' });

  if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
  else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
  if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
  else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
  clearBackendModuleCache();
  fs.rmSync(backupPath, { recursive: true, force: true });
});
