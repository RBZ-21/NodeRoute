const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const authRoutesPath = require.resolve('../routes/portal/auth-routes');
const portalSharedPath = require.resolve('../routes/portal/shared');
const supabasePath = require.resolve('../services/supabase');
const configPath = require.resolve('../lib/config');
const rateLimiterPath = require.resolve('../middleware/rateLimiter');

function clearBackendModuleCache() {
  for (const modulePath of [
    authRoutesPath,
    portalSharedPath,
    supabasePath,
    configPath,
    rateLimiterPath,
  ]) {
    delete require.cache[modulePath];
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('portal verification codes are deleted after use and cannot be replayed', async () => {
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    PORTAL_JWT_SECRET: process.env.PORTAL_JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-portal-replay-'));
  process.env.NODE_ENV = 'test';
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.PORTAL_JWT_SECRET = 'portal-replay-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const { hashCode } = require('../routes/portal/shared');
    const challengeId = 'portal-replay-challenge';
    const code = '123456';

    await supabase.from('portal_challenges').insert({
      id: challengeId,
      email: 'portal.replay@noderoute.test',
      name: 'Portal Replay',
      code_hash: hashCode(challengeId, code),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      attempts_left: 5,
      last_sent_at: new Date().toISOString(),
      company_id: 'company-a',
      location_id: 'location-a',
    });

    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/api/portal', require('../routes/portal/auth-routes')());
    server = await listen(app);

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const payload = {
      challengeId,
      code,
    };

    const firstResponse = await fetch(`${baseUrl}/api/portal/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(firstResponse.status, 200);
    assert.match(firstResponse.headers.get('set-cookie') || '', /portal_token=.*HttpOnly/);

    const { data: remainingChallenges } = await supabase
      .from('portal_challenges')
      .select('*')
      .eq('id', challengeId);
    assert.deepEqual(remainingChallenges, []);

    const replayResponse = await fetch(`${baseUrl}/api/portal/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(replayResponse.status, 401);
    assert.deepEqual(await replayResponse.json(), {
      error: 'This verification code has expired. Please request a new one.',
    });
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});

test('public tracking tokens are bounded by server-side expiry checks', () => {
  const trackingSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tracking.js'), 'utf8');

  assert.ok(trackingSource.includes('tracking_expires_at'), 'tracking route must inspect tracking_expires_at');
  assert.match(trackingSource, /new Date\(order\.tracking_expires_at\)\.getTime\(\) <= Date\.now\(\)/);
  assert.ok(trackingSource.includes('This tracking link has expired'), 'expired tracking links should be rejected');
});
