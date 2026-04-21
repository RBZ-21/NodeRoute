const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { getUserOperatingContext, userResponseWithContext } = require('../services/operating-context');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';
const JWT_EXPIRY = '24h';

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
  return jwt.sign(
    {
      userId: user.id,
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

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = await dbQuery(supabase.from('users').select('*').ilike('email', email).limit(1), res);
  if (!users) return;
  const u = users && users[0];
  if (!u || u.status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });
  const { valid, migrate } = verifyPassword(password, u.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (migrate) {
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(password, 10) }).eq('id', u.id);
  }
  const token = signJWT(u);
  res.json({ token, user: userResponseWithContext(u) });
});

router.post('/setup-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
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
  res.json({ token: sessionToken, user: userResponseWithContext(u) });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json(userResponseWithContext(req.user));
});

router.post('/logout', authenticateToken, (req, res) => {
  // JWTs are stateless; logout is handled client-side by discarding the token
  res.json({ message: 'Logged out' });
});

router.post('/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const { data: user, error } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });
  const { valid } = verifyPassword(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  await supabase.from('users').update({ password_hash: bcrypt.hashSync(newPassword, 10) }).eq('id', req.user.id);
  res.json({ message: 'Password updated' });
});

module.exports = router;
