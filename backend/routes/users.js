const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const logger = require('../services/logger');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { createConfiguredMailers } = require('../services/email');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
  userResponseWithContext,
} = require('../services/operating-context');
const { validateBody } = require('../lib/zod-validate');
const {
  userCreateBodySchema,
  userInviteBodySchema,
  userPatchBodySchema,
  userRolePatchBodySchema,
} = require('../lib/users-schemas');

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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
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

  const safeName = escapeHtml(name);
  const safeRole = escapeHtml(role);

  for (const mailer of mailers) {
    result.emailAttempts.push(mailer.provider || 'unknown');
    try {
      result.emailProvider = mailer.provider || 'unknown';
      logger.info({ provider: result.emailProvider }, 'Sending invite email');
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
              <h2 style="color:#0d1b3e;margin-bottom:8px">Hi ${safeName},</h2>
              <p style="color:#334;font-size:15px;line-height:1.6">
                You've been invited to join <strong>NodeRoute Delivery Systems</strong> as a <strong>${safeRole}</strong>.
              </p>
              <div style="text-align:center;margin:32px 0">
                <a href="${escapeHtml(inviteUrl)}" style="background:#3dba7f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;display:inline-block">
                  Set Up Your Account
                </a>
              </div>
              <p style="color:#667;font-size:13px">This link expires in 48 hours.</p>
            </div>
          </div>
        `
      }), EMAIL_SEND_TIMEOUT_MS, result.emailProvider);
      result.emailSent = true;
      result.emailError = null;
      return result;
    } catch (providerErr) {
      result.emailError = providerErr.message;
      logger.error(
        { provider: result.emailProvider, hasApiKey: !!process.env.RESEND_API_KEY, err: providerErr.message },
        'Invite email delivery failed'
      );
    }
  }

  return result;
}

function isAdminLike(user) {
  return user?.role === 'admin' || user?.role === 'superadmin';
}

router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(scopeQueryByContext(supabase.from('users').select('*'), req.context).order('created_at', { ascending: true }), res);
  if (!data) return;
  const scopedUsers = filterRowsByContext(data, req.context);
  res.json(scopedUsers.map(u => ({ ...userResponseWithContext(u), status: u.status, createdAt: u.created_at })));
});

// Admin: create a user directly with a password (no invite flow)
router.post('/', authenticateToken, requireRole('admin'), validateBody(userCreateBodySchema), async (req, res) => {
  const { name, email, password, role } = req.validated.body;

  const { data: existing } = await supabase.from('users').select('id').ilike('email', email).limit(1);
  if (existing && existing.length > 0) return res.status(409).json({ error: 'A user with that email already exists' });

  const password_hash = await bcrypt.hash(password, 10);
  const insertResult = await insertRecordWithOptionalScope(
    supabase,
    'users',
    {
      id: crypto.randomUUID(),
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

router.post('/invite', authenticateToken, requireRole('admin', 'manager'), validateBody(userInviteBodySchema), async (req, res) => {
  const { name, email, role, companyId, companyName, locationId, locationName } = req.validated.body;
  if (role === 'admin' && !isAdminLike(req.user)) return res.status(403).json({ error: 'Only admins can invite admins' });

  const context = req.context || {};
  const targetCompanyId = companyId || String(context.activeCompanyId || context.companyId || '').trim() || null;
  const targetCompanyName = companyName || String(context.companyName || '').trim() || null;
  const targetLocationId = locationId || String(context.activeLocationId || context.locationId || '').trim() || null;
  const targetLocationName = locationName || String(context.locationName || '').trim() || null;
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

  if (role === 'driver') {
    try {
      await enforceDriverLimit(supabase, { ...req.context, activeCompanyId: targetCompanyId });
    } catch (error) {
      if (sendPlanLimitError(res, error)) return;
      return res.status(500).json({ error: error.message || 'Could not verify subscription limits' });
    }
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

  const inviteUrl = `${BASE_URL}/setup-password?token=${inviteToken}`;
  // Log with masked email — never log the raw token or full invite URL.
  logger.info({ userId: newUser.id, email: maskEmail(email), role }, 'Invite created');

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
    logger.info({
      userId: newUser.id,
      provider: emailResult.emailProvider,
      attempts: emailResult.emailAttempts,
      sent: emailResult.emailSent,
    }, 'Invite email result');
  }

  // Never return the raw invite URL/token in API responses — deliver via email only.
  if (!emailResult.emailSent) {
    logger.warn(
      { userId: newUser.id, email: maskEmail(email) },
      'Invite email failed — admin must resend invite from the Users page',
    );
  }

  res.json({
    message: `Invite created for ${maskEmail(email)}`,
    userId: newUser.id,
    emailSent: emailResult.emailSent,
    emailQueued,
    emailError: emailResult.emailError,
    emailProvider: emailResult.emailProvider,
    emailAttempts: emailResult.emailAttempts,
  });
});

// Any user can update their own profile; admins can update anyone
router.patch('/:id', authenticateToken, validateBody(userPatchBodySchema), async (req, res) => {
  if (req.user.id !== req.params.id && !isAdminLike(req.user))
    return res.status(403).json({ error: 'Forbidden' });
  const { name, phone, vehicle_id } = req.validated.body;
  const updates = { name };
  if (phone !== undefined) updates.phone = phone;
  if (vehicle_id !== undefined) updates.vehicle_id = vehicle_id;
  const { data, error } = await scopeQueryByContext(supabase.from('users').update(updates), req.context).eq('id', req.params.id).select('id,name,phone,vehicle_id').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const users = await dbQuery(scopeQueryByContext(supabase.from('users').select('*'), req.context).eq('id', req.params.id).limit(1), res);
  if (!users) return;
  const u = users && users[0];
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!rowMatchesContext(u, req.context)) return res.status(403).json({ error: 'Forbidden' });
  if ((u.role === 'admin' || u.role === 'superadmin') && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: `Cannot delete ${u.role}` });
  }
  const delResult = await dbQuery(scopeQueryByContext(supabase.from('users').delete(), req.context).eq('id', req.params.id), res);
  if (delResult === null) return;
  res.json({ message: 'User deleted' });
});

router.patch('/:id/role', authenticateToken, requireRole('admin'), validateBody(userRolePatchBodySchema), async (req, res) => {
  const { role } = req.validated.body;
  const currentUser = await dbQuery(scopeQueryByContext(supabase.from('users').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!currentUser) return res.status(404).json({ error: 'User not found' });
  if (!rowMatchesContext(currentUser, req.context)) return res.status(403).json({ error: 'Forbidden' });
  if (currentUser.role === 'superadmin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const data = await dbQuery(scopeQueryByContext(supabase.from('users').update({ role }), req.context).eq('id', req.params.id).select('id').single(), res);
  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Role updated' });
});

module.exports = router;
