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

async function findUserFromTokenPayload(payload) {
  const tokenUserId = normalizeId(payload?.userId || payload?.id || payload?.sub);
  const tokenEmail = normalizeEmail(payload?.email);

  if (tokenUserId) {
    const { data: userById, error: idError } = await supabase.from('users').select('*').eq('id', tokenUserId).single();
    if (userById) return { user: userById, error: null };
    if (idError && !String(idError.message || '').toLowerCase().includes('no rows')) {
      return { user: null, error: idError };
    }
  }

  if (tokenEmail) {
    const { data: usersByEmail, error: emailError } = await supabase.from('users').select('*');
    if (emailError) return { user: null, error: emailError };
    const matched = (Array.isArray(usersByEmail) ? usersByEmail : []).find(
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
