const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendV2 = path.join(__dirname, '../../frontend-v2/src');
const backendRoutes = path.join(__dirname, '..', 'routes');
const backendRoot = path.join(__dirname, '..');
const backendLib = path.join(__dirname, '..', 'lib');
const portalSource = [
  fs.readFileSync(path.join(backendRoutes, 'portal.js'), 'utf8'),
  fs.readFileSync(path.join(backendRoutes, 'portal', 'shared.js'), 'utf8'),
  fs.readFileSync(path.join(backendRoutes, 'portal', 'auth-routes.js'), 'utf8'),
].join('\n');
const authValidationSource = [
  fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8'),
  fs.readFileSync(path.join(backendLib, 'auth-schemas.js'), 'utf8'),
].join('\n');

// ── TrackPage.tsx structural checks ──────────────────────────────────────────

test('TrackPage fetches /api/track/:token (not /api/tracking/)', () => {
  // TrackPage uses useTrackingData hook which contains the fetch call
  const pageSrc = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  const hookSrc = fs.readFileSync(path.join(frontendV2, 'hooks/useTrack.ts'), 'utf8');
  const combined = pageSrc + hookSrc;
  assert.ok(combined.includes('`/api/track/${'), 'must fetch /api/track/ not /api/tracking/');
  assert.ok(!combined.includes('/api/tracking/'), 'must not use /api/tracking/ path');
});

test('TrackPage reads token from ?t= query param', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  assert.ok(src.includes("params.get('t')"), 'must read ?t= param');
});

test('TrackPage handles 410 expired status', () => {
  const hookSrc = fs.readFileSync(path.join(frontendV2, 'hooks/useTrack.ts'), 'utf8');
  const pageSrc = fs.readFileSync(path.join(frontendV2, 'pages/TrackPage.tsx'), 'utf8');
  const combined = hookSrc + pageSrc;
  assert.ok(combined.includes('410'), 'must handle 410 expired response');
  assert.ok(combined.includes("'expired'"), 'must have expired fetch state');
});

test('TrackPage polls every 30 seconds', () => {
  const hookSrc = fs.readFileSync(path.join(frontendV2, 'hooks/useTrack.ts'), 'utf8');
  // refetchInterval can be written as 30_000 or 30000
  assert.ok(hookSrc.includes('30_000') || hookSrc.includes('30000'), 'must set 30s polling interval');
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

test('SetupPasswordPage stores user profile on success', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/SetupPasswordPage.tsx'), 'utf8');
  // Token is stored in HttpOnly cookie by the server; client stores user profile in localStorage
  assert.ok(src.includes('localStorage.setItem'), 'must persist session data to localStorage on success');
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
  assert.ok(src.includes('res.sendFile(frontendV2Entry)'), '/track must serve frontend-v2 entry');
});

test('server.js serves v2 index.html for /setup-password when built', () => {
  const src = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
  assert.ok(src.includes("app.get('/setup-password'"), '/setup-password route must exist');
  assert.ok(src.includes('requireBuildArtifact('), 'server should require built frontend artifacts before boot');
});

test('server.js no longer exposes legacy dashboard or HTML fallbacks', () => {
  const src = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
  assert.ok(!src.includes("app.get('/dashboard-legacy'"), 'legacy dashboard route should be removed');
  assert.ok(!src.includes("path.join(frontendDir, 'index.html')"), 'dashboard should not fall back to frontend/index.html');
  assert.ok(!src.includes("path.join(frontendDir, 'landing.html')"), 'landing should not fall back to frontend/landing.html');
  assert.ok(!src.includes("path.join(frontendDir, 'driver.html')"), 'driver should not fall back to frontend/driver.html');
  assert.ok(!src.includes("path.join(frontendDir, 'customer-portal.html')"), 'portal should not fall back to frontend/customer-portal.html');
  assert.ok(!src.includes("path.join(frontendDir, 'track.html')"), 'track should not fall back to frontend/track.html');
  assert.ok(!src.includes("path.join(frontendDir, 'setup-password.html')"), 'setup-password should not fall back to frontend/setup-password.html');
});

test('App.tsx no longer links to the legacy dashboard escape hatch', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'App.tsx'), 'utf8');
  assert.ok(!src.includes('/dashboard-legacy'), 'AppShell should not link to /dashboard-legacy');
});

// ── auth.js setup-password validation ────────────────────────────────────────

test('auth.js setup-password enforces minimum 12-character password', () => {
  assert.ok(authValidationSource.includes('Password must be at least 12 characters'), 'must reject short passwords');
});

test('auth.js setup-password checks invite token expiry', () => {
  const src = fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8');
  assert.ok(src.includes('invite_expires'), 'must validate invite_expires timestamp');
  assert.ok(src.includes(".gt('invite_expires', new Date().toISOString())"), 'must reject expired invites during token consumption');
  assert.ok(src.includes('Invite link is invalid or has expired.'), 'must return generic invite failure message');
});

test('auth.js setup-password requires both token and password', () => {
  assert.ok(authValidationSource.includes('Token and password required'), 'must require both fields');
});

test('auth.js setup-password atomically consumes invite tokens', () => {
  const src = fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8');
  assert.ok(src.includes(".from('users')\n      .update({\n        password_hash: hashPassword(password),"), 'must consume invites through the password update');
  assert.ok(src.includes(".eq('invite_token', token)"), 'setup update must match the submitted invite token');
  assert.ok(src.includes('invite_token: null'), 'setup update must clear the invite token');
  assert.ok(src.includes('invite_expires: null'), 'setup update must clear invite expiry');
  assert.equal(src.includes("select('*').eq('invite_token', token)"), false, 'must not read invite token before consuming it');
});

// ── Password reset flow checks ───────────────────────────────────────────────

test('ForgotPasswordPage POSTs to /auth/forgot-password', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/ForgotPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('/auth/forgot-password'), 'must POST to /auth/forgot-password');
  assert.ok(src.includes('export function ForgotPasswordPage'), 'must be a named export');
});

test('ResetPasswordPage POSTs to /auth/reset-password and reads ?token=', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/ResetPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('/auth/reset-password'), 'must POST to /auth/reset-password');
  assert.ok(src.includes("params.get('token')"), 'must read ?token= param');
  assert.ok(src.includes('export function ResetPasswordPage'), 'must be a named export');
});

test('ResetPasswordPage validates length and matching passwords', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/ResetPasswordPage.tsx'), 'utf8');
  assert.ok(src.includes('MIN_PASSWORD_LENGTH') && src.includes('12'), 'must enforce 12-char minimum to match backend');
  assert.ok(src.includes('password !== confirm'), 'must check passwords match');
});

test('LoginPage links to forgot-password and drops the Sentry test button', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'pages/LoginPage.tsx'), 'utf8');
  assert.ok(src.includes('/forgot-password'), 'login must link to /forgot-password');
  assert.ok(!src.includes('Break the world'), 'login must not render the Break the world button');
});

test('App.tsx renders forgot/reset password pages', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'App.tsx'), 'utf8');
  assert.ok(src.includes('<ForgotPasswordPage'), 'must render <ForgotPasswordPage />');
  assert.ok(src.includes('<ResetPasswordPage'), 'must render <ResetPasswordPage />');
  assert.ok(src.includes("'/forgot-password'") && src.includes("'/reset-password'"), 'must route both paths');
});

test('useAuth treats forgot/reset password as public paths', () => {
  const src = fs.readFileSync(path.join(frontendV2, 'hooks/useAuth.ts'), 'utf8');
  assert.ok(src.includes('/forgot-password') && src.includes('/reset-password'), 'both paths must bypass the auth redirect');
});

test('server.js serves v2 index.html for /forgot-password and /reset-password', () => {
  const src = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
  assert.ok(src.includes("app.get('/forgot-password'"), '/forgot-password route must exist');
  assert.ok(src.includes("app.get('/reset-password'"), '/reset-password route must exist');
});

test('auth.js forgot-password is enumeration-safe and hashes the reset token', () => {
  const src = fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8');
  assert.ok(src.includes('If an account exists for that email'), 'must return a generic response regardless of account existence');
  assert.ok(src.includes('hashResetToken'), 'must store a hashed token, never the raw value');
  assert.ok(src.includes('reset_expires'), 'must set a reset expiry');
});

test('auth.js reset-password checks expiry, clears the token, and rate-limits', () => {
  const src = fs.readFileSync(path.join(backendRoutes, 'auth.js'), 'utf8');
  assert.ok(src.includes('This reset link is invalid or has expired.'), 'must reject invalid/expired tokens');
  assert.ok(src.includes('reset_token: null'), 'must clear the token after use');
  assert.ok(src.includes(".update({\n        password_hash: hashPassword(password),"), 'must consume reset tokens through the password update');
  assert.ok(src.includes(".eq('reset_token', hashResetToken(token))"), 'reset update must match the submitted token');
  assert.ok(src.includes(".gt('reset_expires', new Date().toISOString())"), 'reset update must reject expired tokens atomically');
  assert.ok(src.includes('passwordResetLimiter'), 'reset endpoints must be rate-limited');
});

test('auth-schemas exports forgot/reset password parsers', () => {
  assert.ok(authValidationSource.includes('parseForgotPasswordBody'), 'must export parseForgotPasswordBody');
  assert.ok(authValidationSource.includes('parseResetPasswordBody'), 'must export parseResetPasswordBody');
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
