const test = require('node:test');
const assert = require('node:assert/strict');

const { requireRole, requireSuperadmin } = require('../middleware/auth');

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
  const req = { user: { id: 'sa-1', role: 'superadmin', email: 'owner@example.com' } };
  const res = createResponse();
  let nextCalled = false;

  await requireRole('admin')(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireSuperadmin allows a superadmin role even if the configured owner email differs', () => {
  const req = { user: { id: 'sa-1', role: 'superadmin', email: 'different-owner@example.com' } };
  const res = createResponse();
  let nextCalled = false;

  requireSuperadmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireSuperadmin still rejects non-superadmin users', () => {
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
