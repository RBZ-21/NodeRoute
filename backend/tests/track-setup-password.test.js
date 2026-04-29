const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendV2 = path.join(__dirname, '../../frontend-v2/src');
const backendRoutes = path.join(__dirname, '..', 'routes');
const backendRoot = path.join(__dirname, '..');
const portalSource = [
  fs.readFileSync(path.join(backendRoutes, 'portal.js'), 'utf8'),
  fs.readFileSync(path.join(backendRoutes, 'portal', 'shared.js'), 'utf8'),
  fs.readFileSync(path.join(backendRoutes, 'portal', 'auth-routes.js'), 'utf8'),
].join('\n');

// ── TrackPage.tsx structural checks ──────────────────────────────────────────

test('TrackPage fetches /api/track/:token (not /api/tracking/)', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  assert.ok(src.includes('`/api/track/${'), 'must fetch /api/track/ not /api/tracking/');
  assert.ok(!src.includes('/api/tracking/'), 'must not use /api/tracking/ path');
});

test('TrackPage reads token from ?t= query param', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  assert.ok(src.includes("params.get('t')"), 'must read ?t= param');
});

test('TrackPage handles 410 expired status', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  assert.ok(src.includes('410'), 'must handle 410 expired response');
  assert.ok(src.includes("'expired'"), 'must have expired fetch state');
});

test('TrackPage polls every 30 seconds', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  assert.ok(src.includes('30000'), 'must set 30s polling interval');
});

test('TrackPage persists notify preference to localStorage', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  assert.ok(src.includes('nr-track-notify'), 'must use nr-track-notify localStorage key');
});

test('TrackPage is exported as named export', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  assert.ok(src.includes('export function TrackPage'), 'TrackPage must be a named export');
});

// ── SetupPasswordPage.tsx structural checks ───────────────────────────────────

test('SetupPasswordPage POSTs to /auth/setup-password', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/SetupPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('/auth/setup-password'), 'must POST to /auth/setup-password');
});

test('SetupPasswordPage reads invite token from ?token= query param', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/SetupPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes("params.get('token')"), 'must read ?token= param');
});

test('SetupPasswordPage validates minimum password length of 8', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/SetupPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('length < 8'), 'must enforce 8-char minimum');
});

test('SetupPasswordPage validates passwords match', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/SetupPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('password !== confirm'), 'must check passwords match');
});

test('SetupPasswordPage stores nr_token on success', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/SetupPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('nr_token'), 'must store nr_token in localStorage');
});

test('SetupPasswordPage is exported as named export', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/SetupPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('export function SetupPasswordPage'), 'SetupPasswordPage must be a named export');
});

// ── App.tsx routing checks ────────────────────────────────────────────────────

test('App.tsx has isTrackRoute auth bypass', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'App.tsx'), 'utf8');
  assert.ok(src.includes('isTrackRoute'), 'App.tsx must have isTrackRoute bypass');
  assert.ok(src.includes("'/track'"), 'isTrackRoute must match /track path');
});

test('App.tsx has isSetupPasswordRoute auth bypass', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'App.tsx'), 'utf8');
  assert.ok(src.includes('isSetupPasswordRoute'), 'App.tsx must have isSetupPasswordRoute bypass');
  assert.ok(src.includes("'/setup-password'"), 'isSetupPasswordRoute must match /setup-password path');
});

test('App.tsx renders TrackPage for track route', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'App.tsx'), 'utf8');
  assert.ok(src.includes('<TrackPage'), 'App.tsx must render <TrackPage />');
});

test('App.tsx renders SetupPasswordPage for setup-password route', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'App.tsx'), 'utf8');
  assert.ok(src.includes('<SetupPasswordPage'), 'App.tsx must render <SetupPasswordPage />');
});

// ── server.js routing checks ──────────────────────────────────────────────────

test('server.js serves v2 index.html for /track when built', () => {
  const src = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
  assert.ok(src.includes("app.get('/track'"), '/track route must exist');
  assert.ok(src.includes('hasFrontendV2Build'), '/track must check for v2 build');
});

test('server.js serves v2 index.html for /setup-password when built', () => {
  const src = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
  assert.ok(src.includes("app.get('/setup-password'"), '/setup-password route must exist');
});

// ── auth.js setup-password validation ────────────────────────────────────────

test('auth.js setup-password enforces minimum 8-character password', () => {
  const src = fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8');
  assert.ok(src.includes('Password must be at least 8 characters'), 'must reject short passwords');
});

test('auth.js setup-password checks invite token expiry', () => {
  const src = fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8');
  assert.ok(src.includes('invite_expires'), 'must validate invite_expires timestamp');
  assert.ok(src.includes('Invite link expired'), 'must return expiry error message');
});

test('auth.js setup-password requires both token and password', () => {
  const src = fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8');
  assert.ok(src.includes('Token and password required'), 'must require both fields');
});

// ── portal.js auth hardening checks ──────────────────────────────────────────

test('portal.js uses Supabase portal_challenges table not in-memory Map', () => {
  assert.ok(!portalSource.includes('portalChallenges'), 'must not use in-memory portalChallenges Map');
  assert.ok(portalSource.includes("from('portal_challenges')"), 'must query portal_challenges table');
});

test('portal.js uses Supabase portal_auth_attempts table not in-memory Map', () => {
  assert.ok(!portalSource.includes('authAttempts'), 'must not use in-memory authAttempts Map');
  assert.ok(portalSource.includes("from('portal_auth_attempts')"), 'must query portal_auth_attempts table');
});

test('portal.js challenge uses snake_case DB field names', () => {
  assert.ok(portalSource.includes('code_hash'), 'must use code_hash not codeHash');
  assert.ok(portalSource.includes('expires_at'), 'must use expires_at not expiresAt');
  assert.ok(portalSource.includes('attempts_left'), 'must use attempts_left not attemptsLeft');
  assert.ok(portalSource.includes('last_sent_at'), 'must use last_sent_at not lastSentAt');
  assert.ok(portalSource.includes('company_id'), 'must store company_id in challenge');
  assert.ok(portalSource.includes('location_id'), 'must store location_id in challenge');
});

test('portal.js signPortalJWT receives only safe context fields from challenge', () => {
  assert.ok(portalSource.includes('companyId: challenge.company_id'), 'must extract companyId from DB field');
  assert.ok(portalSource.includes('locationId: challenge.location_id'), 'must extract locationId from DB field');
  assert.ok(!portalSource.includes('signPortalJWT(challenge.email, challenge.name, challenge)'), 'must not pass raw challenge to JWT signer');
});
