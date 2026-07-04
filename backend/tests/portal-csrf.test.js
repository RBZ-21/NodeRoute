const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

function clearPortalSharedCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}portal${path.sep}shared.js`) ||
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`)
    ) {
      delete require.cache[key];
    }
  }
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

function loadShared() {
  const previousSecret = process.env.PORTAL_JWT_SECRET;
  process.env.PORTAL_JWT_SECRET = 'portal-csrf-test-secret';
  clearPortalSharedCache();
  const shared = require('../routes/portal/shared');
  return {
    shared,
    restore() {
      if (previousSecret === undefined) delete process.env.PORTAL_JWT_SECRET;
      else process.env.PORTAL_JWT_SECRET = previousSecret;
      clearPortalSharedCache();
    },
  };
}

function portalToken() {
  return jwt.sign(
    {
      email: 'portal.customer@noderoute.test',
      name: 'Portal Customer',
      role: 'customer',
      companyId: 'company-a',
      locationId: 'loc-a',
    },
    'portal-csrf-test-secret',
    { expiresIn: '1h' }
  );
}

test('portal cookie-authenticated mutations require a matching CSRF token', () => {
  const { shared, restore } = loadShared();
  try {
    const req = {
      method: 'PATCH',
      cookies: { portal_token: portalToken() },
      headers: {},
    };
    const res = createResponse();
    let nextCalled = false;

    shared.authenticatePortalToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Invalid CSRF token' });
  } finally {
    restore();
  }
});

test('portal cookie-authenticated mutations pass with matching CSRF token', () => {
  const { shared, restore } = loadShared();
  try {
    const csrfToken = 'portal-csrf-token';
    const req = {
      method: 'PATCH',
      cookies: { portal_token: portalToken(), 'csrf-token': csrfToken },
      headers: { 'x-csrf-token': csrfToken },
    };
    const res = createResponse();
    let nextCalled = false;

    shared.authenticatePortalToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(req.portalContext.activeCompanyId, 'company-a');
  } finally {
    restore();
  }
});

test('portal bearer-authenticated mutations do not require CSRF token', () => {
  const { shared, restore } = loadShared();
  try {
    const req = {
      method: 'PATCH',
      cookies: {},
      headers: { authorization: `Bearer ${portalToken()}` },
    };
    const res = createResponse();
    let nextCalled = false;

    shared.authenticatePortalToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  } finally {
    restore();
  }
});

test('portal auth cookie helper issues a readable CSRF cookie', () => {
  const { shared, restore } = loadShared();
  try {
    const cookies = [];
    const res = {
      cookie(name, value, options) {
        cookies.push({ name, value, options });
      },
    };

    shared.setPortalAuthCookie(res, 'portal-token-value');

    const portalCookie = cookies.find((cookie) => cookie.name === 'portal_token');
    const csrfCookie = cookies.find((cookie) => cookie.name === 'csrf-token');
    assert.equal(portalCookie.options.httpOnly, true);
    assert.equal(csrfCookie.options.httpOnly, false);
    assert.equal(csrfCookie.value.length, 64);
  } finally {
    restore();
  }
});
