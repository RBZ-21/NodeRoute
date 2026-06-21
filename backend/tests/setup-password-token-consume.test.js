const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const authPath = require.resolve('../routes/auth');
const middlewarePath = require.resolve('../middleware/auth');
const supabasePath = require.resolve('../services/supabase');
const configPath = require.resolve('../lib/config');

function clearBackendModuleCache() {
  for (const modulePath of [authPath, middlewarePath, supabasePath, configPath]) {
    delete require.cache[modulePath];
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('setup-password consumes an invite token exactly once', async () => {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-setup-consume-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'setup-password-consume-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'invited-user-001',
      name: 'Invited User',
      email: 'invited.user@noderoute.test',
      role: 'manager',
      status: 'invited',
      invite_token: 'one-time-invite-token',
      invite_expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      company_id: 'invite-company-a',
      location_id: 'invite-location-a',
    });

    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/auth', require('../routes/auth'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const payload = {
      token: 'one-time-invite-token',
      password: 'StrongInvitePass123!',
    };

    const firstResponse = await fetch(`${baseUrl}/auth/setup-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.json();
    assert.equal(firstBody.user.email, 'invited.user@noderoute.test');
    assert.match(firstResponse.headers.get('set-cookie') || '', /refresh-token=.*HttpOnly/);

    const secondResponse = await fetch(`${baseUrl}/auth/setup-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(secondResponse.status, 400);
    const secondBody = await secondResponse.json();
    assert.equal(secondBody.error, 'Invite link is invalid or has expired.');

    const { data: user } = await supabase.from('users').select('*').eq('id', 'invited-user-001').single();
    assert.equal(user.status, 'active');
    assert.equal(user.invite_token, null);
    assert.equal(user.invite_expires, null);
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
