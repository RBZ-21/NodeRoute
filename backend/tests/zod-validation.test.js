const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const configModulePath = path.join(__dirname, '..', 'lib', 'config.js');
const authSchemasModulePath = path.join(__dirname, '..', 'lib', 'auth-schemas.js');
const inventoryWriteSchemasModulePath = path.join(__dirname, '..', 'lib', 'inventory-write-schemas.js');
const schemasModulePath = path.join(__dirname, '..', 'lib', 'schemas.js');
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

const requiredConfigEnv = {
  JWT_SECRET: 'test-jwt-secret',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

function loadFreshConfig() {
  delete require.cache[require.resolve(configModulePath)];
  return require(configModulePath);
}

test('config uses Zod-backed normalization for numeric, boolean, enum, and list env vars', () => {
  withEnv({
    ...requiredConfigEnv,
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
    ...requiredConfigEnv,
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

test('config exits when a required secret is missing', () => {
  withEnv({
    ...requiredConfigEnv,
    JWT_SECRET: undefined,
  }, () => {
    const config = loadFreshConfig();
    const logs = { warn: [], error: [], fatal: [], info: [] };
    const logger = {
      warn(message) { logs.warn.push(message); },
      error(message) { logs.error.push(message); },
      fatal(message) { logs.fatal.push(message); },
      info(message) { logs.info.push(message); },
    };
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit:${code}`);
    };

    try {
      assert.throws(() => config.validate(logger), /process\.exit:1/);
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, 1);
    assert.ok(logs.fatal.some((message) => message.includes('JWT_SECRET is not set')));
  });
});

test('config exits in production when PORTAL_JWT_SECRET is unset', () => {
  withEnv({
    ...requiredConfigEnv,
    NODE_ENV: 'production',
    PORTAL_JWT_SECRET: undefined,
    ADMIN_PASSWORD: 'MyStr0ng!Pass123',
    SUPERADMIN_EMAIL: 'admin@example.com',
  }, () => {
    const config = loadFreshConfig();
    const logs = { warn: [], error: [], fatal: [], info: [] };
    const logger = {
      warn(message) { logs.warn.push(message); },
      error(message) { logs.error.push(message); },
      fatal(message) { logs.fatal.push(message); },
      info(message) { logs.info.push(message); },
    };
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit:${code}`);
    };

    try {
      assert.throws(() => config.validate(logger), /process\.exit:1/);
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, 1);
    assert.ok(logs.fatal.some((message) => message.includes('PORTAL_JWT_SECRET is not set')));
  });
});

test('config exits for degraded production-only unsafe settings', () => {
  withEnv({
    ...requiredConfigEnv,
    NODE_ENV: 'production',
    PORTAL_JWT_SECRET: 'prod-portal-secret-value',
    ADMIN_PASSWORD: 'Str0ng!ProdPassw0rd#2026',
    SUPERADMIN_EMAIL: undefined,
  }, () => {
    const config = loadFreshConfig();
    const logs = { warn: [], error: [], fatal: [], info: [] };
    const logger = {
      warn(message) { logs.warn.push(message); },
      error(message) { logs.error.push(message); },
      fatal(message) { logs.fatal.push(message); },
      info(message) { logs.info.push(message); },
    };
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit:${code}`);
    };

    try {
      assert.throws(() => config.validate(logger), /process\.exit:1/);
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, 1);
    assert.ok(logs.error.some((message) => message.includes('BASE_URL is not set')));
    assert.ok(logs.error.some((message) => message.includes('CORS_ORIGINS is not set')));
    assert.ok(logs.fatal.some((message) => message.includes('Fatal configuration errors')));
  });
});

test('config keeps production warnings non-fatal when unsafe errors are fixed', () => {
  withEnv({
    ...requiredConfigEnv,
    NODE_ENV: 'production',
    PORTAL_JWT_SECRET: 'prod-portal-secret-value',
    ADMIN_PASSWORD: 'Str0ng!ProdPassw0rd#2026',
    BASE_URL: 'https://app.example.com',
    CORS_ORIGINS: 'https://app.example.com',
    SUPERADMIN_EMAIL: undefined,
  }, () => {
    const config = loadFreshConfig();
    const logs = { warn: [], error: [], fatal: [], info: [] };
    const logger = {
      warn(message) { logs.warn.push(message); },
      error(message) { logs.error.push(message); },
      fatal(message) { logs.fatal.push(message); },
      info(message) { logs.info.push(message); },
    };
    const originalExit = process.exit;
    let exitCalled = false;
    process.exit = () => {
      exitCalled = true;
      throw new Error('process.exit');
    };

    try {
      assert.doesNotThrow(() => config.validate(logger));
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCalled, false);
    assert.ok(logs.warn.some((message) => message.includes('SUPERADMIN_EMAIL is not set')));
    assert.ok(logs.warn.some((message) => message.includes('SESSION_SECRET or CSRF_SECRET is not set')));
    assert.equal(logs.fatal.length, 0);
  });
});

test('config exits in production when ADMIN_PASSWORD is missing or weak', () => {
  for (const adminPassword of [undefined, 'Admin@123', 'short1!A']) {
    withEnv({
      ...requiredConfigEnv,
      NODE_ENV: 'production',
      ADMIN_PASSWORD: adminPassword,
    }, () => {
      const config = loadFreshConfig();
      const logs = { warn: [], error: [], fatal: [], info: [] };
      const logger = {
        warn(message) { logs.warn.push(message); },
        error(message) { logs.error.push(message); },
        fatal(message) { logs.fatal.push(message); },
        info(message) { logs.info.push(message); },
      };
      const originalExit = process.exit;
      let exitCode = null;
      process.exit = (code) => {
        exitCode = code;
        throw new Error(`process.exit:${code}`);
      };

      try {
        assert.throws(() => config.validate(logger), /process\.exit:1/);
      } finally {
        process.exit = originalExit;
      }

      assert.equal(exitCode, 1);
      assert.ok(
        logs.fatal.some((message) => message.includes('ADMIN_PASSWORD is missing, default, or too weak')),
        `expected fatal ADMIN_PASSWORD message for ${JSON.stringify(adminPassword)}`
      );
    });
  }
});

test('config exits in production when required secrets use placeholders', () => {
  for (const [key, value] of [
    ['SUPABASE_SERVICE_ROLE_KEY', 'your-service-role-key'],
    ['OPENAI_API_KEY', 'changeme'],
    ['TWILIO_AUTH_TOKEN', 'YOUR_TWILIO_AUTH_TOKEN_HERE'],
  ]) {
    withEnv({
      ...requiredConfigEnv,
      NODE_ENV: 'production',
      PORTAL_JWT_SECRET: 'prod-portal-secret-value',
      ADMIN_PASSWORD: 'Str0ng!ProdPassw0rd#2026',
      BASE_URL: 'https://app.example.com',
      CORS_ORIGINS: 'https://app.example.com',
      SUPERADMIN_EMAIL: 'owner@example.com',
      [key]: value,
    }, () => {
      const config = loadFreshConfig();
      const logs = { warn: [], error: [], fatal: [], info: [] };
      const logger = {
        warn(message) { logs.warn.push(message); },
        error(message) { logs.error.push(message); },
        fatal(message) { logs.fatal.push(message); },
        info(message) { logs.info.push(message); },
      };
      const originalExit = process.exit;
      let exitCode = null;
      process.exit = (code) => {
        exitCode = code;
        throw new Error(`process.exit:${code}`);
      };

      try {
        assert.throws(() => config.validate(logger), /process\.exit:1/);
      } finally {
        process.exit = originalExit;
      }

      assert.equal(exitCode, 1);
      assert.ok(
        logs.fatal.some((message) => message.includes(`${key} is a placeholder or unsafe default`)),
        `expected fatal placeholder message for ${key}`
      );
    });
  }
});

test('config exits in production when Stripe payments are enabled without signing secrets', () => {
  withEnv({
    ...requiredConfigEnv,
    NODE_ENV: 'production',
    PORTAL_JWT_SECRET: 'prod-portal-secret-value',
    ADMIN_PASSWORD: 'Str0ng!ProdPassw0rd#2026',
    BASE_URL: 'https://app.example.com',
    CORS_ORIGINS: 'https://app.example.com',
    SUPERADMIN_EMAIL: 'owner@example.com',
    PORTAL_PAYMENT_ENABLED: 'true',
    PORTAL_PAYMENT_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: '',
  }, () => {
    const config = loadFreshConfig();
    const logs = { warn: [], error: [], fatal: [], info: [] };
    const logger = {
      warn(message) { logs.warn.push(message); },
      error(message) { logs.error.push(message); },
      fatal(message) { logs.fatal.push(message); },
      info(message) { logs.info.push(message); },
    };
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit:${code}`);
    };

    try {
      assert.throws(() => config.validate(logger), /process\.exit:1/);
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, 1);
    assert.ok(logs.fatal.some((message) => message.includes('STRIPE_SECRET_KEY is required when Stripe payments are enabled')));
    assert.ok(logs.fatal.some((message) => message.includes('STRIPE_WEBHOOK_SECRET is required when Stripe payments are enabled')));
  });
});

test('config derives session and csrf secrets from jwt secret when unset', () => {
  withEnv({
    ...requiredConfigEnv,
    SESSION_SECRET: undefined,
    CSRF_SECRET: undefined,
  }, () => {
    const config = loadFreshConfig();
    assert.equal(config.SESSION_SECRET, 'test-jwt-secret');
    assert.equal(config.CSRF_SECRET, 'test-jwt-secret');
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

  assert.deepEqual(parseSetupPasswordBody({ token: ' invite-token ', password: 'long-enough-password' }), {
    success: true,
    data: { token: 'invite-token', password: 'long-enough-password' },
  });
  assert.deepEqual(parseSetupPasswordBody({ token: '', password: 'long-enough-password' }), {
    success: false,
    error: 'Token and password required',
  });
  assert.deepEqual(parseSetupPasswordBody({ token: 'invite-token', password: 'short' }), {
    success: false,
    error: 'Password must be at least 12 characters',
  });

  assert.deepEqual(parseChangePasswordBody({ currentPassword: 'old-pass', newPassword: 'new-secret-pw-1' }), {
    success: true,
    data: { currentPassword: 'old-pass', newPassword: 'new-secret-pw-1' },
  });
  assert.deepEqual(parseChangePasswordBody({ currentPassword: '', newPassword: '' }), {
    success: false,
    error: 'Both passwords required',
  });
  assert.deepEqual(parseChangePasswordBody({ currentPassword: 'old-pass', newPassword: 'short' }), {
    success: false,
    error: 'New password must be at least 12 characters',
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

test('order schemas accept null for clearable optional string fields', () => {
  const { orderUpdateSchema, orderFulfillSchema } = require(schemasModulePath);

  assert.doesNotThrow(() => orderUpdateSchema.parse({
    customerEmail: '',
    customerPhone: '',
    customerAddress: '',
    notes: '',
    routeId: null,
    stopId: null,
  }));

  assert.doesNotThrow(() => orderFulfillSchema.parse({
    items: [],
    driverName: null,
    routeId: null,
  }));
});

test('inventory count schema coerces string quantities and rejects invalid entries', () => {
  const { inventoryCountBodySchema } = require(inventoryWriteSchemasModulePath);

  const parsed = inventoryCountBodySchema.parse({
    notes: ' Cycle count ',
    items: [
      { item_number: ' FSH-001 ', counted_qty: '12.5' },
      { item_number: 42, counted_qty: 0 },
    ],
  });

  assert.equal(parsed.notes, 'Cycle count');
  assert.deepEqual(parsed.items, [
    { item_number: 'FSH-001', counted_qty: 12.5 },
    { item_number: '42', counted_qty: 0 },
  ]);
  assert.throws(() => inventoryCountBodySchema.parse({ items: [] }));
  assert.throws(() => inventoryCountBodySchema.parse({ items: [{ item_number: '', counted_qty: '1' }] }));
  assert.throws(() => inventoryCountBodySchema.parse({ items: [{ item_number: 'FSH-001', counted_qty: '' }] }));
  assert.throws(() => inventoryCountBodySchema.parse({ items: [{ item_number: 'FSH-001', counted_qty: '-1' }] }));
  assert.throws(() => inventoryCountBodySchema.parse({ items: [{ item_number: 'FSH-001', counted_qty: 'not-a-number' }] }));
});

test('inventory lot patch schema coerces numeric strings and strips missing optionals', () => {
  const { inventoryLotPatchBodySchema } = require(inventoryWriteSchemasModulePath);

  assert.deepEqual(inventoryLotPatchBodySchema.parse({
    qty_on_hand: '8.25',
    cost_per_unit: '3.50',
    supplier_name: ' Dock A ',
  }), {
    qty_on_hand: 8.25,
    cost_per_unit: 3.5,
    supplier_name: 'Dock A',
  });
  assert.deepEqual(inventoryLotPatchBodySchema.parse({ notes: '' }), { notes: null });
  assert.deepEqual(inventoryLotPatchBodySchema.parse({ qty_on_hand: '1', notes: undefined }), { qty_on_hand: 1 });
  assert.throws(() => inventoryLotPatchBodySchema.parse({}));
  assert.throws(() => inventoryLotPatchBodySchema.parse({ qty_on_hand: 'bad' }));
  assert.throws(() => inventoryLotPatchBodySchema.parse({ qty_on_hand: '1', unexpected: true }));
});

test('inventory product patch schema coerces number and boolean strings', () => {
  const { inventoryProductPatchBodySchema } = require(inventoryWriteSchemasModulePath);

  assert.deepEqual(inventoryProductPatchBodySchema.parse({
    description: ' Blue Mussels ',
    cost: '4.75',
    on_hand_qty: '11',
    default_price_per_lb: '',
    is_catch_weight: 'yes',
  }), {
    description: 'Blue Mussels',
    cost: 4.75,
    on_hand_qty: 11,
    is_catch_weight: true,
  });
  assert.deepEqual(inventoryProductPatchBodySchema.parse({ notes: null }), { notes: null });
  assert.deepEqual(inventoryProductPatchBodySchema.parse({ notes: '' }), { notes: null });
  assert.throws(() => inventoryProductPatchBodySchema.parse({}));
  assert.throws(() => inventoryProductPatchBodySchema.parse({ cost: 'bad' }));
  assert.throws(() => inventoryProductPatchBodySchema.parse({ is_catch_weight: 'maybe' }));
  assert.throws(() => inventoryProductPatchBodySchema.parse({ cost: '1', unknown_field: 'x' }));
});
