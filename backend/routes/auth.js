const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');

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
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', email)
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const u = users && users[0];
  if (!u || u.status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });
  const { valid, migrate } = verifyPassword(password, u.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (migrate) {
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(password, 10) }).eq('id', u.id);
  }
  const token = signJWT(u);
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

router.post('/setup-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .eq('invite_token', token)
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
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
  res.json({ token: sessionToken, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
});

router.post('/logout', authenticateToken, (req, res) => {
  // JWTs are stateless; logout is handled client-side by discarding the token
  res.json({ message: 'Logged out' });
});

module.exports = router;
