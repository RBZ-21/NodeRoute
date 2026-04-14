const express = require('express');
const crypto = require('crypto');
const supabase = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { createMailer } = require('../services/email');

const router = express.Router();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, status, created_at')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.created_at })));
});

router.post('/invite', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, email, role = 'driver' } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can invite admins' });

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .ilike('email', email)
    .limit(1);
  if (existing && existing.length > 0) return res.status(409).json({ error: 'Email already exists' });

  const inviteToken = crypto.randomBytes(32).toString('hex');
  const newUser = {
    id: 'user-' + Date.now(),
    name,
    email,
    password_hash: null,
    role,
    status: 'pending',
    invite_token: inviteToken,
    invite_expires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString()
  };
  const { error: insertErr } = await supabase.from('users').insert([newUser]);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  const inviteUrl = `${BASE_URL}/setup-password.html?token=${inviteToken}`;
  console.log(`\nINVITE for ${name} (${email}) as ${role}:\n${inviteUrl}\n`);
  // Send real email if SMTP configured
  try {
    const mailer = createMailer();
    if (mailer) {
      await mailer.sendMail({
        from: process.env.EMAIL_FROM || `NodeRoute Systems <${process.env.SMTP_USER}>`,
        to: email,
        subject: `You've been invited to NodeRoute`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#050d2a;padding:24px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#3dba7f;margin:0;font-size:24px">NodeRoute Systems</h1>
            </div>
            <div style="background:#f8faff;padding:32px;border-radius:0 0 12px 12px">
              <h2 style="color:#0d1b3e;margin-bottom:8px">Hi ${name},</h2>
              <p style="color:#334;font-size:15px;line-height:1.6">
                You've been invited to join <strong>NodeRoute Delivery Systems</strong> as a <strong>${role}</strong>.
              </p>
              <div style="text-align:center;margin:32px 0">
                <a href="${inviteUrl}" style="background:#3dba7f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;display:inline-block">
                  Set Up Your Account
                </a>
              </div>
              <p style="color:#667;font-size:13px">This link expires in 48 hours.</p>
              <p style="color:#667;font-size:13px">Or copy this URL: ${inviteUrl}</p>
            </div>
          </div>
        `
      });
    }
  } catch(emailErr) {
    console.error('Failed to send invite email:', emailErr.message);
  }
  res.json({ message: `Invite sent to ${email}`, userId: newUser.id, inviteUrl });
});

router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { data: users, error } = await supabase.from('users').select('id, role').eq('id', req.params.id).limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const u = users && users[0];
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });
  const { error: delErr } = await supabase.from('users').delete().eq('id', req.params.id);
  if (delErr) return res.status(500).json({ error: delErr.message });
  res.json({ message: 'User deleted' });
});

router.patch('/:id/role', authenticateToken, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const { data, error } = await supabase.from('users').update({ role }).eq('id', req.params.id).select('id').single();
  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Role updated' });
});

module.exports = router;
