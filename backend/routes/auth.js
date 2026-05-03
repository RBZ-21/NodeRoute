const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { getUserOperatingContext, userResponseWithContext } = require('../services/operating-context');
const {
  parseLoginBody,
  parseSetupPasswordBody,
  parseChangePasswordBody,
} = require('../lib/auth-schemas');
const {
  loginLimiter,
  setupPasswordLimiter,
  changePasswordLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';
const JWT_EXPIRY = '24h';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 h in ms

const IS_PROD = process.env.NODE_ENV === 'production';

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }

// Auto-migrates legacy SHA256 hashes to bcrypt on login
function verifyPassword(pw, stored) {
  if (!stored) return { valid: false, migrate: false };
  if (!stored.startsWith('$2') && stored.length === 64) {
    const legacy = crypto.createHash('sha256').update(pw + 'noderoute-salt').digest('hex');
    return { valid: legacy === stored, migrate: true };
  }
  return { valid: bcrypt.compareSync(pw, stored), migrate: false };
}

function signJWT(user) {
  const context = getUserOperatingContext(user);
  const userId = user?.id;
  return jwt.sign(
    {
      userId,
      id: userId,
      sub: userId,
      email: user.email,
      role: user.role,
      companyId: context.companyId,
      locationId: context.locationId,
      platformRole: context.platformRole,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Sets the HttpOnly auth cookie and a readable CSRF token cookie.
 * The CSRF cookie is NOT HttpOnly so the frontend JS can read it
 * and send it back as the X-CSRF-Token header on mutations.
 */
function setAuthCookies(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
  // Readable CSRF token — same session, different cookie
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf-token', csrfToken, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearAuthCookies(res) {
  res.clearCookie('token', { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/' });
  res.clearCookie('csrf-token', { httpOnly: false, secure: IS_PROD, sameSite: 'strict', path: '/' });
}

// POST /auth/login — 5 attempts / 15 min
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = parseLoginBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { email, password } = parsed.data;

  const normalizedEmail = email.toLowerCase();
  const users = await dbQuery(supabase.from('users').select('*'), res);
  if (!users) return;

  const u = (Array.isArray(users) ? users : []).find(
    (user) => String(user?.email || '').trim().toLowerCase() === normalizedEmail
  );

  if (!u || u.status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });
  const { valid, migrate } = verifyPassword(password, u.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (migrate) {
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(password, 10) }).eq('id', u.id);
  }
  const token = signJWT(u);
  setAuthCookies(res, token);
  // token still returned in body for backwards-compat with any existing API consumers
  res.json({ token, user: userResponseWithContext(u) });
});

// POST /auth/setup-password — 10 attempts / hour
router.post('/setup-password', setupPasswordLimiter, async (req, res) => {
  const parsed = parseSetupPasswordBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { token, password } = parsed.data;
  const users = await dbQuery(supabase.from('users').select('*').eq('invite_token', token).limit(1), res);
  if (!users) return;
  const u = users && users[0];
  if (!u) return res.status(400).json({ error: 'Invalid invite token' });
  if (new Date() > new Date(u.invite_expires)) return res.status(400).json({ error: 'Invite link expired' });
  await supabase.from('users').update({
    password_hash: hashPassword(password),
    status: 'active',
    invite_token: null,
    invite_expires: null
  }).eq('id', u.id);
  const sessionToken = signJWT(u);
  setAuthCookies(res, sessionToken);
  res.json({ token: sessionToken, user: userResponseWithContext(u) });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json(userResponseWithContext(req.user));
});

router.post('/logout', authenticateToken, (req, res) => {
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
});

// POST /auth/change-password — 5 attempts / 15 min
router.post('/change-password', authenticateToken, changePasswordLimiter, async (req, res) => {
  const parsed = parseChangePasswordBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { currentPassword, newPassword } = parsed.data;
  const { data: user, error } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });
  const { valid } = verifyPassword(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  await supabase.from('users').update({ password_hash: bcrypt.hashSync(newPassword, 10) }).eq('id', req.user.id);
  res.json({ message: 'Password updated' });
});

module.exports = router;
