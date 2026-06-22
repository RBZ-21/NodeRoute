'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { supabase } = require('../services/supabase');
const { buildRequestContext } = require('../services/operating-context');

// Use the config module which provides a dev fallback. In production, config.js
// already validates that JWT_SECRET is set to a non-default value.
const { JWT_SECRET, SUPERADMIN_EMAIL } = require('../lib/config');

// Methods that mutate state — CSRF check is enforced on these.
const CSRF_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

// Routes that are exempt from CSRF (they set or refresh non-cookie credentials).
const CSRF_EXEMPT = new Set([
  '/login', '/signup', '/setup-password', '/forgot-password', '/reset-password',
  '/refresh', '/logout', '/driver/login', '/driver/refresh',
]);

// Columns safe to attach to req.user — never load password_hash or token fields.
// NOTE: only physical columns of the `users` table may be listed here — this is
// selected directly with no fallback, so a non-existent column makes every
// authenticated request fail with a 503. `company_name`/`location_name` are NOT
// columns on `users`; operating-context derives them (with defaults) from the
// company/location ids, so they must not be selected here.
const USER_AUTH_FIELDS = [
  'id', 'name', 'email', 'role', 'status', 'company_id', 'location_id',
  'platform_role', 'phone', 'vehicle_id',
  'created_at',
].join(',');

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeEmail(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function extractRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

async function findUserFromTokenPayload(payload) {
  const tokenUserId = normalizeId(
    payload?.userId || payload?.id || payload?.sub || payload?.user_id
  );
  const tokenEmail = normalizeEmail(
    payload?.email || payload?.userEmail || payload?.user_email
  );

  // Fast path: query by ID directly — no full table scan.
  if (tokenUserId) {
    const { data, error } = await supabase
      .from('users')
      .select(USER_AUTH_FIELDS)
      .eq('id', tokenUserId)
      .single();
    if (!error && data) return { user: data, dbError: null, notFound: false };
    // PGRST116 = no rows — genuine missing user, not an infrastructure failure.
    if (error && error.code !== 'PGRST116') return { user: null, dbError: error, notFound: false };
  }

  // Fallback: query by email (handles legacy tokens that lack a userId).
  if (tokenEmail) {
    const { data, error } = await supabase
      .from('users')
      .select(USER_AUTH_FIELDS)
      .eq('email', tokenEmail)
      .single();
    if (!error && data) return { user: data, dbError: null, notFound: false };
    if (error && error.code !== 'PGRST116') return { user: null, dbError: error, notFound: false };
  }

  return { user: null, dbError: null, notFound: true };
}

function extractAuthToken(req) {
  const cookieToken = req.cookies?.token;
  if (cookieToken) return { token: cookieToken, source: 'cookie' };

  const [scheme, token] = String(req.headers.authorization || '').split(/\s+/);
  if (scheme?.toLowerCase() === 'bearer' && token) {
    return { token, source: 'bearer' };
  }

  return { token: null, source: null };
}

function extractToken(req) {
  return extractAuthToken(req).token;
}

/**
 * CSRF double-submit check.
 * The server sets a readable `csrf-token` cookie on login.
 * The frontend reads it and sends it back as X-CSRF-Token on every mutation.
 * We verify both values match using constant-time comparison.
 * Attackers on other origins cannot read the cookie due to SameSite=Strict
 * + same-origin policy, so they can\'t forge the header.
 */
function verifyCsrf(req) {
  if (!CSRF_METHODS.has(req.method)) return true;
  if (CSRF_EXEMPT.has(req.path)) return true;
  const cookieToken = req.cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken) return false;
  try {
    const a = Buffer.from(cookieToken);
    const b = Buffer.from(String(headerToken));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function authenticateToken(req, res, next) {
  const { token, source } = extractAuthToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  if (payload?.tokenType === 'refresh' || payload?.tokenType === 'driver_refresh') {
    return res.status(401).json({ error: 'Access token required' });
  }

  const { user, dbError, notFound } = await findUserFromTokenPayload(payload);
  if (dbError) return res.status(503).json({ error: 'Authentication service temporarily unavailable' });
  if (notFound || !user) return res.status(401).json({ error: 'User not found' });

  if (source === 'cookie' && !verifyCsrf(req)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  req.user = user;
  req.context = buildRequestContext(req, user);
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin') return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/**
 * requireSuperadmin — must run AFTER authenticateToken.
 *
 * Passes only when BOTH conditions are met:
 *   1. req.user.role === 'superadmin'
 *   2. normalizeEmail(req.user.email) === normalizeEmail(SUPERADMIN_EMAIL)
 *
 * The error response is intentionally generic — it does not reveal which
 * check failed so an attacker cannot probe which email addresses are
 * privileged.
 *
 * When SUPERADMIN_EMAIL is unset (sentinel '__superadmin_unset__'), the
 * email check never passes, so the gate is fail-closed by default.
 */
function requireSuperadmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const roleOk  = req.user.role === 'superadmin';
  if (!roleOk) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const configuredEmail = normalizeEmail(SUPERADMIN_EMAIL);
  const requestEmail = normalizeEmail(req.user.email);
  if (
    req.user.role === 'superadmin'
    && requestEmail !== configuredEmail
  ) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

module.exports = { authenticateToken, requireRole, requireSuperadmin, extractToken };
