const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { createConfiguredMailers } = require('../services/email');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  userResponseWithContext,
} = require('../services/operating-context');

const router = express.Router();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const EMAIL_SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 5000);

function withTimeout(promise, timeoutMs, provider) {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${provider || 'email provider'} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
}

async function sendInviteEmail({ name, email, role, inviteUrl }) {
  const result = {
    emailSent: false,
    emailError: null,
    emailProvider: null,
    emailAttempts: [],
  };

  const mailers = createConfiguredMailers();
  if (!mailers.length) {
    result.emailError = 'No email provider configured';
    return result;
  }

  for (const mailer of mailers) {
    result.emailAttempts.push(mailer.provider || 'unknown');
    try {
      result.emailProvider = mailer.provider || 'unknown';
      console.log(`Sending invite email via ${result.emailProvider}`, { to: email, from: process.env.EMAIL_FROM });
      await withTimeout(mailer.sendMail({
        from: process.env.EMAIL_FROM,
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
      }), EMAIL_SEND_TIMEOUT_MS, result.emailProvider);
      result.emailSent = true;
      result.emailError = null;
      return result;
    } catch (providerErr) {
      result.emailError = providerErr.message;
      console.error(`EMAIL ERROR - ${result.emailProvider} failed for invite email:`, providerErr.message, {
        provider: result.emailProvider,
        hasApiKey: !!process.env.RESEND_API_KEY,
        from: process.env.EMAIL_FROM,
        to: email,
      });
    }
  }

  return result;
}

router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('users').select('*').order('created_at', { ascending: true }), res);
  if (!data) return;
  const scopedUsers = filterRowsByContext(data, req.context);
  res.json(scopedUsers.map(u => ({ ...userResponseWithContext(u), status: u.status, createdAt: u.created_at })));
});

// Admin: create a user directly with a password (no invite flow)
router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  const { name, email, password, role = 'driver' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const { data: existing } = await supabase.from('users').select('id').ilike('email', email).limit(1);
  if (existing && existing.length > 0) return res.status(409).json({ error: 'A user with that email already exists' });

  const password_hash = await bcrypt.hash(password, 10);
  const insertResult = await insertRecordWithOptionalScope(
    supabase,
    'users',
    {
      id: 'user-' + Date.now(),
      name,
      email,
      password_hash,
      role,
      status: 'active',
      invite_token: null,
      invite_expires: null,
      created_at: new Date().toISOString(),
    },
    req.context
  );
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  res.status(201).json({ message: `User ${email} created successfully`, user: userResponseWithContext(insertResult.data) });
});

router.post('/invite', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, email, role = 'driver', companyId, companyName, locationId, locationName } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can invite admins' });

  const context = req.context || {};
  const targetCompanyId = String(companyId || context.activeCompanyId || context.companyId || '').trim() || null;
  const targetCompanyName = String(companyName || context.companyName || '').trim() || null;
  const targetLocationId = String(locationId || context.activeLocationId || context.locationId || '').trim() || null;
  const targetLocationName = String(locationName || context.locationName || '').trim() || null;
  const canInviteAcrossCompanies = !!context.isGlobalOperator;
  const allowedCompanyIds = Array.isArray(context.accessibleCompanyIds) ? context.accessibleCompanyIds : [];
  const allowedLocationIds = Array.isArray(context.accessibleLocationIds) ? context.accessibleLocationIds : [];

  if (!targetCompanyId) return res.status(400).json({ error: 'companyId is required for invite scoping' });
  if (!canInviteAcrossCompanies && allowedCompanyIds.length && !allowedCompanyIds.includes(targetCompanyId)) {
    return res.status(403).json({ error: 'Cannot invite users outside your company scope' });
  }
  if (!canInviteAcrossCompanies && targetLocationId && allowedLocationIds.length && !allowedLocationIds.includes(targetLocationId)) {
    return res.status(403).json({ error: 'Cannot invite users outside your location scope' });
  }

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
  const insertResult = await insertRecordWithOptionalScope(
    supabase,
    'users',
    {
      ...newUser,
      ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
      ...(targetCompanyName ? { company_name: targetCompanyName } : {}),
      ...(targetLocationId ? { location_id: targetLocationId } : {}),
      ...(targetLocationName ? { location_name: targetLocationName } : {}),
    },
    req.context
  );
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });

  const inviteUrl = `${BASE_URL}/setup-password.html?token=${inviteToken}`;
  console.log(`\nINVITE for ${name} (${email}) as ${role}:\n${inviteUrl}\n`);
  const queuedMailers = createConfiguredMailers();
  const emailQueued = queuedMailers.length > 0;

  let emailResult = {
    emailSent: false,
    emailError: emailQueued ? null : 'No email provider configured',
    emailProvider: null,
    emailAttempts: [],
  };

  if (emailQueued) {
    emailResult = await sendInviteEmail({ name, email, role, inviteUrl });
    console.log('Invite email result:', {
      email,
      provider: emailResult.emailProvider,
      attempts: emailResult.emailAttempts,
      sent: emailResult.emailSent,
      error: emailResult.emailError,
    });
  }

  res.json({
    message: `Invite created for ${email}`,
    userId: newUser.id,
    inviteUrl,
    emailSent: emailResult.emailSent,
    emailQueued,
    emailError: emailResult.emailError,
    emailProvider: emailResult.emailProvider,
    emailAttempts: emailResult.emailAttempts,
  });
});

// Any user can update their own name; admins can update anyone
router.patch('/:id', authenticateToken, async (req, res) => {
  if (req.user.id !== req.params.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const { data, error } = await supabase.from('users').update({ name: name.trim() }).eq('id', req.params.id).select('id,name').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const users = await dbQuery(supabase.from('users').select('*').eq('id', req.params.id).limit(1), res);
  if (!users) return;
  const u = users && users[0];
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!rowMatchesContext(u, req.context)) return res.status(403).json({ error: 'Forbidden' });
  if (u.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });
  const delResult = await dbQuery(supabase.from('users').delete().eq('id', req.params.id), res);
  if (delResult === null) return;
  res.json({ message: 'User deleted' });
});

router.patch('/:id/role', authenticateToken, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const currentUser = await dbQuery(supabase.from('users').select('*').eq('id', req.params.id).single(), res);
  if (!currentUser) return res.status(404).json({ error: 'User not found' });
  if (!rowMatchesContext(currentUser, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('users').update({ role }).eq('id', req.params.id).select('id').single(), res);
  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Role updated' });
});

module.exports = router;
