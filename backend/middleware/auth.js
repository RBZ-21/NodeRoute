'use strict';

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const { supabase }             = require('../services/supabase');
const { buildRequestContext }  = require('../services/operating-context');
const { JWT_SECRET }           = require('../lib/config');

// ── Constants ─────────────────────────────────────────────────────────────────

const CSRF_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const CSRF_EXEMPT  = new Set(['/login', '/setup-password']);

// The single email address allowed to access superadmin routes.
// Set SUPERADMIN_EMAIL in your .env / hosting environment.
// Falls back to a deliberately invalid value so it never accidentally matches.
const SUPERADMIN_EMAIL = (
  process.env.SUPERADMIN_EMAIL || '__no_superadmin_configured__'
).trim().toLowerCase();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeEmail(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

async function findUserFromTokenPayload(payload) {
  const tokenUserId = normalizeId(
    payload?.userId || payload?.id || payload?.sub || payload?.user_id
  );
  const tokenEmail = normalizeEmail(
    payload?.email || payload?.userEmail || payload?.user_email
  );

  if (tokenUserId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', tokenUserId)
      .single();
    if (!error && data) return { user: data, dbError: null, notFound: false };
    if (error && error.code !== 'PGRST116') return { user: null, dbError: error, notFound: false };
  }

  if (tokenEmail) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', tokenEmail)
      .single();
    if (!error && data) return { user: data, dbError: null, notFound: false };
    if (error && error.code !== 'PGRST116') return { user: null, dbError: error, notFound: false };
  }

  return { user: null, dbError: null, notFound: true };
}

function extractToken(req) {
  return req.cookies?.token || null;
}

function verifyCsrf(req) {
  if (!CSRF_METHODS.has(req.method)) return true;
  if (CSRF_EXEMPT.has(req.path))     return true;
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

// ── Core auth middleware ───────────────────────────────────────────────────────

async function authenticateToken(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const { user, dbError, notFound } = await findUserFromTokenPayload(payload);
  if (dbError)           return res.status(503).json({ error: 'Authentication service temporarily unavailable' });
  if (notFound || !user) return res.status(401).json({ error: 'User not found' });

  if (!verifyCsrf(req)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  req.user    = user;
  req.context = buildRequestContext(req, user);
  next();
}

// ── Role middleware ────────────────────────────────────────────────────────────

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin') return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ── Superadmin-only middleware ─────────────────────────────────────────────────
//
// Double-checks BOTH:
//   1. role === 'superadmin'   (database role column)
//   2. email === SUPERADMIN_EMAIL  (env var — only the owner's email)
//
// Even if someone's role is set to superadmin by mistake, their email
// won't match, so they get a generic 403 with no information leak.

function requireSuperadmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const roleOk  = req.user.role === 'superadmin';
  const emailOk = normalizeEmail(req.user.email) === SUPERADMIN_EMAIL;

  if (!roleOk || !emailOk) {
    // Deliberately vague — don't reveal which check failed.
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

module.exports = { authenticateToken, requireRole, requireSuperadmin, extractToken };
