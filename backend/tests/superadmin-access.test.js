const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

function clearAuthConfigCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`)
      || key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`)
      || key.includes(`${path.sep}backend${path.sep}routes${path.sep}superadmin.js`)
      || key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function loadAuthWithSuperadminEmail(email = 'owner@example.com') {
  const previous = process.env.SUPERADMIN_EMAIL;
  process.env.SUPERADMIN_EMAIL = email;
  clearAuthConfigCache();
  const auth = require('../middleware/auth');
  if (previous === undefined) delete process.env.SUPERADMIN_EMAIL;
  else process.env.SUPERADMIN_EMAIL = previous;
  return auth;
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('requireRole lets superadmin pass admin-only checks', async () => {
  const { requireRole } = loadAuthWithSuperadminEmail();
  const req = { user: { id: 'sa-1', role: 'superadmin', email: 'owner@example.com' } };
  const res = createResponse();
  let nextCalled = false;

  await requireRole('admin')(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('restoreSessionHandler rejects saved superadmin sessions when SUPERADMIN_EMAIL is unset', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const previousSuperadminEmail = process.env.SUPERADMIN_EMAIL;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-superadmin-restore-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.SUPERADMIN_EMAIL = '__superadmin_unset__';
  clearAuthConfigCache();

  try {
    const { supabase } = require('../services/supabase');
    const superadminRouter = require('../routes/superadmin');
    const { SUPERADMIN_EMAIL } = require('../lib/config');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    assert.equal(SUPERADMIN_EMAIL, '__superadmin_unset__');

    const inserted = await supabase.from('users').insert({
      id: 'superadmin-restore-001',
      name: 'Platform Owner',
      email: 'owner@example.com',
      role: 'superadmin',
      status: 'active',
    });
    assert.ifError(inserted.error);
    const existing = await supabase
      .from('users')
      .select('id,email,role,status')
      .eq('id', 'superadmin-restore-001')
      .single();
    assert.ifError(existing.error);
    assert.deepEqual(
      {
        id: existing.data?.id,
        email: existing.data?.email,
        role: existing.data?.role,
        status: existing.data?.status,
      },
      {
        id: 'superadmin-restore-001',
        email: 'owner@example.com',
        role: 'superadmin',
        status: 'active',
      }
    );

    const savedToken = jwt.sign(
      {
        userId: 'superadmin-restore-001',
        email: 'owner@example.com',
        role: 'superadmin',
      },
      jwtSecret,
      { expiresIn: '1h' }
    );

    const req = { cookies: { sa_session: savedToken } };
    const cookies = [];
    const clearedCookies = [];
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
      cookie(name, value, options) {
        cookies.push({ name, value, options });
        return this;
      },
      clearCookie(name, options) {
        clearedCookies.push({ name, options });
        return this;
      },
    };

    await superadminRouter.restoreSessionHandler(req, res);

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Saved session is not a superadmin session.' });
    assert.deepEqual(cookies, []);
    assert.deepEqual(clearedCookies, []);
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    if (previousSuperadminEmail === undefined) delete process.env.SUPERADMIN_EMAIL;
    else process.env.SUPERADMIN_EMAIL = previousSuperadminEmail;
    clearAuthConfigCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});

test('requireSuperadmin rejects a superadmin role when the configured owner email differs', () => {
  const { requireSuperadmin } = loadAuthWithSuperadminEmail('owner@example.com');
  const req = { user: { id: 'sa-1', role: 'superadmin', email: 'different-owner@example.com' } };
  const res = createResponse();
  let nextCalled = false;

  requireSuperadmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
});

test('requireSuperadmin still rejects non-superadmin users', () => {
  const { requireSuperadmin } = loadAuthWithSuperadminEmail();
  const req = { user: { id: 'admin-1', role: 'admin', email: 'admin@example.com' } };
  const res = createResponse();
  let nextCalled = false;

  requireSuperadmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
});

test('requireSuperadmin allows only the configured owner email', () => {
  const { requireSuperadmin } = loadAuthWithSuperadminEmail('owner@example.com');
  const req = { user: { id: 'sa-1', role: 'superadmin', email: 'owner@example.com' } };
  const res = createResponse();
  let nextCalled = false;

  requireSuperadmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireSuperadmin normalizes case and whitespace for the configured owner email', () => {
  const { requireSuperadmin } = loadAuthWithSuperadminEmail(' Owner@Example.com ');
  const req = { user: { id: 'sa-1', role: 'superadmin', email: ' owner@example.COM ' } };
  const res = createResponse();
  let nextCalled = false;

  requireSuperadmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireSuperadmin rejects missing, null, or malformed superadmin email claims', () => {
  const { requireSuperadmin } = loadAuthWithSuperadminEmail('owner@example.com');

  for (const email of [undefined, null, '', ' owner@example.com.attacker.test ']) {
    const req = { user: { id: 'sa-1', role: 'superadmin', email } };
    const res = createResponse();
    let nextCalled = false;

    requireSuperadmin(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  }
});

test('requireSuperadmin rejects superadmin role when SUPERADMIN_EMAIL is unset', () => {
  const { requireSuperadmin } = loadAuthWithSuperadminEmail('__superadmin_unset__');
  const req = { user: { id: 'sa-1', role: 'superadmin', email: 'owner@example.com' } };
  const res = createResponse();
  let nextCalled = false;

  requireSuperadmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
});
