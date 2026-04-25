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
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-auth-compat-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
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

  const req = { headers: { authorization: `Bearer ${token}` } };
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

  if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
  else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
  clearBackendModuleCache();
  fs.rmSync(backupPath, { recursive: true, force: true });
});
