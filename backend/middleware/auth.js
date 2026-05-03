const jwt = require('jsonwebtoken');
const { supabase } = require('../services/supabase');
const { buildRequestContext } = require('../services/operating-context');

const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

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
 * Priority: HttpOnly cookie → Authorization: Bearer header.
 * This dual-read supports Step 2 of the JWT migration plan (cookie-first
 * with header fallback). Once the frontend stops writing to localStorage
 * and all clients move to cookies, the header fallback can be removed.
 */
function extractToken(req) {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function authenticateToken(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const { user, error } = await findUserFromTokenPayload(payload);
  if (error || !user) return res.status(401).json({ error: 'User not found' });
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
