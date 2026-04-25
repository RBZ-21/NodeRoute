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

async function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
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
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { authenticateToken, requireRole };
