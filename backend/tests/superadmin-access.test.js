const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');

function clearAuthConfigCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`)
      || key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`)
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
