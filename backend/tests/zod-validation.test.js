const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const configModulePath = path.join(__dirname, '..', 'lib', 'config.js');
const authSchemasModulePath = path.join(__dirname, '..', 'lib', 'auth-schemas.js');
const zodValidateModulePath = path.join(__dirname, '..', 'lib', 'zod-validate.js');

function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function loadFreshConfig() {
  delete require.cache[require.resolve(configModulePath)];
  return require(configModulePath);
}

test('config uses Zod-backed normalization for numeric, boolean, enum, and list env vars', () => {
  withEnv({
    PORT: '4100',
    PORTAL_PAYMENT_ENABLED: 'TRUE',
    PORTAL_PAYMENT_PROVIDER: 'mystery',
    EMAIL_PROVIDER: 'fallback',
    CORS_ORIGINS: ' https://one.example , https://two.example ',
  }, () => {
    const config = loadFreshConfig();

    assert.equal(config.PORT, 4100);
    assert.equal(config.PORTAL_PAYMENT_ENABLED, true);
    assert.equal(config.PORTAL_PAYMENT_PROVIDER, 'manual');
    assert.equal(config.EMAIL_PROVIDER, 'auto');
    assert.deepEqual(config.CORS_ORIGINS, ['https://one.example', 'https://two.example']);
  });
});

test('config falls back safely when PORT is invalid and warns on malformed values', () => {
  withEnv({
    PORT: 'not-a-number',
    PORTAL_PAYMENT_ENABLED: 'yes',
    PORTAL_PAYMENT_PROVIDER: 'invalid-provider',
    BASE_URL: 'not-a-url',
  }, () => {
    const config = loadFreshConfig();
    const logs = { warn: [], error: [], fatal: [], info: [] };
    const logger = {
      warn(message) { logs.warn.push(message); },
      error(message) { logs.error.push(message); },
      fatal(message) { logs.fatal.push(message); },
      info(message) { logs.info.push(message); },
    };

    config.validate(logger);

    assert.equal(config.PORT, 3001);
    assert.ok(logs.warn.some((message) => message.includes('PORTAL_PAYMENT_ENABLED="yes"')));
    assert.ok(logs.warn.some((message) => message.includes('PORTAL_PAYMENT_PROVIDER="invalid-provider"')));
    assert.ok(logs.warn.some((message) => message.includes('BASE_URL is not a valid absolute URL')));
  });
});

test('auth schema helpers normalize login payloads and preserve existing error messages', () => {
  const {
    parseLoginBody,
    parseSetupPasswordBody,
    parseChangePasswordBody,
  } = require(authSchemasModulePath);

  assert.deepEqual(parseLoginBody({ email: '  Ops@NodeRoute.test  ', password: 'secret' }), {
    success: true,
    data: { email: 'Ops@NodeRoute.test', password: 'secret' },
  });
  assert.deepEqual(parseLoginBody({ email: '', password: '' }), {
    success: false,
    error: 'Email and password required',
  });

  assert.deepEqual(parseSetupPasswordBody({ token: ' invite-token ', password: '12345678' }), {
    success: true,
    data: { token: 'invite-token', password: '12345678' },
  });
  assert.deepEqual(parseSetupPasswordBody({ token: '', password: '12345678' }), {
    success: false,
    error: 'Token and password required',
  });
  assert.deepEqual(parseSetupPasswordBody({ token: 'invite-token', password: 'short' }), {
    success: false,
    error: 'Password must be at least 8 characters',
  });

  assert.deepEqual(parseChangePasswordBody({ currentPassword: 'old-pass', newPassword: 'new-secret' }), {
    success: true,
    data: { currentPassword: 'old-pass', newPassword: 'new-secret' },
  });
  assert.deepEqual(parseChangePasswordBody({ currentPassword: '', newPassword: '' }), {
    success: false,
    error: 'Both passwords required',
  });
  assert.deepEqual(parseChangePasswordBody({ currentPassword: 'old-pass', newPassword: 'short' }), {
    success: false,
    error: 'New password must be at least 8 characters',
  });
});

test('shared validate helpers attach parsed body and query data to req.validated', async () => {
  const { z } = require('zod');
  const { validateBody, validateQuery } = require(zodValidateModulePath);

  const bodyMiddleware = validateBody(z.object({ qty: z.coerce.number().int().positive() }));
  const queryMiddleware = validateQuery(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).passthrough());

  const req = {
    body: { qty: '7' },
    query: { date: '2026-04-30', extra: 'keep-me' },
  };
  const res = {
    status() { throw new Error('status should not be called'); },
    json() { throw new Error('json should not be called'); },
  };

  let nextCalls = 0;
  await bodyMiddleware(req, res, () => { nextCalls++; });
  await queryMiddleware(req, res, () => { nextCalls++; });

  assert.equal(nextCalls, 2);
  assert.deepEqual(req.validated.body, { qty: 7 });
  assert.deepEqual(req.validated.query, { date: '2026-04-30', extra: 'keep-me' });
});

test('shared validate helpers return the first Zod issue as a 400 error', async () => {
  const { z } = require('zod');
  const { validateBody } = require(zodValidateModulePath);

  const middleware = validateBody(z.object({ lat: z.coerce.number().min(-90).max(90) }));
  const req = { body: { lat: '500' } };
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

  await middleware(req, res, () => {
    throw new Error('next should not be called for invalid payloads');
  });

  assert.equal(statusCode, 400);
  assert.deepEqual(payload, { error: 'Too big: expected number to be <=90' });
});
