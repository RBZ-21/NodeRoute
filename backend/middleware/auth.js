'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { supabase } = require('../services/supabase');
const { buildRequestContext } = require('../services/operating-context');

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start without it.');
}
const JWT_SECRET = process.env.JWT_SECRET;

// Methods that mutate state — CSRF check is enforced on these.
const CSRF_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

// Routes that are exempt from CSRF (they set the cookie, so no token exists yet).
const CSRF_EXEMPT = new Set(['/login', '/setup-password']);

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
  const tokenUserId = normalizeId(payload?.userId || payload?.id || payload?.sub || payload?.user_id);
  const tokenEmail = normalizeEmail(payload?.email) || normalizeEmail(payload?.userEmail || payload?.user_email);
  const usersResult = await supabase.from('users').select('*');
  const users = extractRows(usersResult);

  if (tokenUserId) {
    const userById = users.find((user) => normalizeId(user?.id) === tokenUserId);
    if (userById) return { user: userById, error: null };
  }

  if (tokenEmail) {
    const matched = users.find(
      (user) => normalizeEmail(user?.email) === tokenEmail
    );
    if (matched) return { user: matched, error: null };
  }

  return { user: null, error: null };
}

/**
 * Extract a raw JWT string from the request.
 * Cookie-only — the Authorization: Bearer header fallback was removed in Step 4
 * of the JWT migration. All clients must authenticate via the HttpOnly cookie.
 */
function extractToken(req) {
  return req.cookies?.token || null;
}

/**
 * CSRF double-submit check.
 * The server sets a readable `csrf-token` cookie on login.
 * The frontend reads it and sends it back as X-CSRF-Token on every mutation.
 * We verify both values match using constant-time comparison.
 * Attackers on other origins cannot read the cookie due to SameSite=Strict
 * + same-origin policy, so they can't forge the header.
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
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const { user, error } = await findUserFromTokenPayload(payload);
  if (error || !user) return res.status(401).json({ error: 'User not found' });

  if (!verifyCsrf(req)) {
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

module.exports = { authenticateToken, requireRole, extractToken };
