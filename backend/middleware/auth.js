const jwt = require('jsonwebtoken');
const { supabase } = require('../services/supabase');
const { buildRequestContext } = require('../services/operating-context');

const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

function firstString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

async function findUserForTokenPayload(payload) {
  const userId = firstString(payload.userId, payload.user_id, payload.sub, payload.id);
  if (userId) {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (user) return user;
  }

  const email = firstString(payload.email, payload.userEmail, payload.user_email).toLowerCase();
  if (!email) return null;

  const { data: users, error } = await supabase.from('users').select('*');
  if (error || !Array.isArray(users)) return null;

  return users.find((user) => String(user?.email || '').trim().toLowerCase() === email) || null;
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
  const user = await findUserForTokenPayload(payload);
  if (!user) return res.status(401).json({ error: 'User not found' });
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
