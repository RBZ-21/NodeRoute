const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabase } = require('../services/supabase');
const { createConfiguredMailers } = require('../services/email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';
const PORTAL_CODE_TTL_MS = Number(process.env.PORTAL_CODE_TTL_MS || 10 * 60 * 1000);
const PORTAL_MAX_VERIFY_ATTEMPTS = Number(process.env.PORTAL_MAX_VERIFY_ATTEMPTS || 5);
const PORTAL_RESEND_COOLDOWN_MS = Number(process.env.PORTAL_RESEND_COOLDOWN_MS || 60 * 1000);
const PORTAL_AUTH_RATE_WINDOW_MS = Number(process.env.PORTAL_AUTH_RATE_WINDOW_MS || 15 * 60 * 1000);
const PORTAL_AUTH_RATE_LIMIT = Number(process.env.PORTAL_AUTH_RATE_LIMIT || 5);
const PORTAL_PREVIEW_EMAILS = String(process.env.PORTAL_PREVIEW_EMAILS || '').split(',').map(v => normalizeEmail(v)).filter(Boolean);

function signPortalJWT(email, name, context = {}) {
  return jwt.sign(
    {
      email,
      name,
      role: 'customer',
      companyId: context.companyId || null,
      locationId: context.locationId || null,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function canUsePortalPreview(email) {
  const normalized = normalizeEmail(email);
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!normalized) return false;
  return normalized === adminEmail || PORTAL_PREVIEW_EMAILS.includes(normalized);
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCode(challengeId, code) {
  return crypto.createHash('sha256').update(`${challengeId}:${String(code || '').trim()}`).digest('hex');
}

function codesMatch(expectedHash, actualHash) {
  const expected = Buffer.from(String(expectedHash || ''), 'utf8');
  const actual = Buffer.from(String(actualHash || ''), 'utf8');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

async function pruneExpiredChallenges() {
  const now = new Date().toISOString();
  const windowStart = new Date(Date.now() - PORTAL_AUTH_RATE_WINDOW_MS).toISOString();
  await supabase.from('portal_challenges').delete().lte('expires_at', now);
  await supabase.from('portal_auth_attempts').delete().lte('attempted_at', windowStart);
}

async function touchRateLimitBucket(email) {
  await supabase.from('portal_auth_attempts').insert({
    id: crypto.randomBytes(16).toString('hex'),
    email,
    attempted_at: new Date().toISOString(),
  });
}

async function canRequestCode(email) {
  const windowStart = new Date(Date.now() - PORTAL_AUTH_RATE_WINDOW_MS).toISOString();
  const { data } = await supabase.from('portal_auth_attempts')
    .select('id').eq('email', email).gte('attempted_at', windowStart);
  return (data?.length || 0) < PORTAL_AUTH_RATE_LIMIT;
}

async function resolvePortalCustomer(email) {
  const normalized = normalizeEmail(email);
  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .ilike('customer_email', normalized)
    .order('created_at', { ascending: false })
    .limit(1);
  if (invoiceError) throw invoiceError;
  if (invoices && invoices.length > 0) {
    return {
      email: normalized,
      name: invoices[0].customer_name || normalized,
      companyId: invoices[0].company_id || null,
      locationId: invoices[0].location_id || null,
    };
  }

  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .ilike('customer_email', normalized)
    .order('created_at', { ascending: false })
    .limit(1);
  if (orderError) throw orderError;
  if (orders && orders.length > 0) {
    return {
      email: normalized,
      name: orders[0].customer_name || normalized,
      companyId: orders[0].company_id || null,
      locationId: orders[0].location_id || null,
    };
  }

  // Check Customers table by billing_email — allows customers to log in before any order exists
  const { data: customers } = await supabase
    .from('Customers')
    .select('company_name, billing_email, company_id, location_id')
    .ilike('billing_email', normalized)
    .limit(1);
  if (customers && customers.length > 0) {
    return {
      email: normalized,
      name: customers[0].company_name || normalized,
      companyId: customers[0].company_id || null,
      locationId: customers[0].location_id || null,
    };
  }

  if (canUsePortalPreview(normalized)) {
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .ilike('email', normalized)
      .limit(1);
    if (userError) throw userError;
    const u = Array.isArray(users) ? users[0] : null;
    return {
      email: normalized,
      name: (u && u.name) || 'Portal Preview',
      companyId: (u && u.company_id) || process.env.DEFAULT_COMPANY_ID || null,
      locationId: (u && u.location_id) || process.env.DEFAULT_LOCATION_ID || null,
    };
  }

  return null;
}

async function sendPortalCodeEmail({ email, name, code }) {
  const mailers = createConfiguredMailers();
  if (!mailers.length) throw new Error('Customer portal email verification is not configured');

  let lastError = null;
  for (const mailer of mailers) {
    try {
      await mailer.sendMail({
        to: email,
        subject: 'Your NodeRoute customer portal verification code',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#102040">
            <div style="background:#050d2a;padding:24px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#3dba7f;margin:0;font-size:24px">NodeRoute Customer Portal</h1>
            </div>
            <div style="background:#f8faff;padding:32px;border:1px solid #dde3f5;border-top:none;border-radius:0 0 12px 12px">
              <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${name || 'there'},</p>
              <p style="font-size:15px;line-height:1.6;margin:0 0 20px">
                Use the verification code below to access your customer portal. The code expires in 10 minutes.
              </p>
              <div style="font-size:34px;font-weight:700;letter-spacing:0.3em;text-align:center;color:#050d2a;background:#e8f5ee;border:1px solid #b8e0c8;border-radius:12px;padding:18px 20px;margin:0 0 20px">
                ${code}
              </div>
              <p style="font-size:13px;line-height:1.6;color:#667085;margin:0">
                If you did not request this code, you can ignore this email.
              </p>
            </div>
          </div>
        `,
        text: `Your NodeRoute customer portal verification code is ${code}. It expires in 10 minutes.`,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Could not send portal verification email');
}

function authenticatePortalToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let payload;
  try {
    payload = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (payload.role !== 'customer') return res.status(403).json({ error: 'Forbidden' });
  req.customerEmail = payload.email;
  req.customerName = payload.name;
  req.portalContext = {
    companyId: payload.companyId || null,
    activeCompanyId: payload.companyId || null,
    activeLocationId: payload.locationId || null,
    accessibleLocationIds: payload.locationId ? [payload.locationId] : [],
    isGlobalOperator: false,
  };
  next();
}

// POST /api/portal/auth — send a short-lived verification code to the customer email
router.post('/auth', async (req, res) => {
  await pruneExpiredChallenges();

  const normalized = normalizeEmail(req.body?.email);
  if (!normalized) return res.status(400).json({ error: 'Email required' });
  if (!(await canRequestCode(normalized))) {
    return res.status(429).json({ error: 'Too many portal login attempts. Please wait a few minutes and try again.' });
  }

  try {
    const customer = await resolvePortalCustomer(normalized);
    if (!customer) {
      await touchRateLimitBucket(normalized);
      return res.status(404).json({ error: 'No account found for that email. Contact your NodeRoute representative.' });
    }

    const nowIso = new Date().toISOString();
    const { data: existingRows } = await supabase.from('portal_challenges')
      .select('*').eq('email', normalized).gte('expires_at', nowIso).limit(1);
    const existing = existingRows?.[0] || null;

    if (existing) {
      const lastSentMs = new Date(existing.last_sent_at).getTime();
      if (Date.now() - lastSentMs < PORTAL_RESEND_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((PORTAL_RESEND_COOLDOWN_MS - (Date.now() - lastSentMs)) / 1000);
        return res.status(429).json({
          error: 'A verification code was just sent. Please wait a moment before requesting another one.',
          retryAfterSeconds,
        });
      }
    }

    const challengeId = crypto.randomBytes(24).toString('hex');
    const code = generateVerificationCode();

    if (existing) await supabase.from('portal_challenges').delete().eq('id', existing.id);
    await sendPortalCodeEmail({ email: customer.email, name: customer.name, code });
    await supabase.from('portal_challenges').insert({
      id: challengeId,
      email: customer.email,
      name: customer.name,
      code_hash: hashCode(challengeId, code),
      expires_at: new Date(Date.now() + PORTAL_CODE_TTL_MS).toISOString(),
      attempts_left: PORTAL_MAX_VERIFY_ATTEMPTS,
      last_sent_at: new Date().toISOString(),
      company_id: customer.companyId || null,
      location_id: customer.locationId || null,
    });
    await touchRateLimitBucket(normalized);

    return res.json({
      challengeId,
      maskedEmail: customer.email.replace(/(^.).*(@.*$)/, '$1***$2'),
      name: customer.name,
      expiresInSeconds: Math.floor(PORTAL_CODE_TTL_MS / 1000),
    });
  } catch (error) {
    console.error('portal/auth:', error.message);
    return res.status(500).json({ error: error.message || 'Could not start customer portal sign-in' });
  }
});

router.post('/verify', async (req, res) => {
  await pruneExpiredChallenges();

  const challengeId = String(req.body?.challengeId || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!challengeId || !code) return res.status(400).json({ error: 'Challenge ID and verification code are required' });

  const { data: challengeRows } = await supabase.from('portal_challenges')
    .select('*').eq('id', challengeId).limit(1);
  const challenge = challengeRows?.[0] || null;

  if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
    if (challenge) await supabase.from('portal_challenges').delete().eq('id', challengeId);
    return res.status(401).json({ error: 'This verification code has expired. Please request a new one.' });
  }

  if (!codesMatch(challenge.code_hash, hashCode(challengeId, code))) {
    const attemptsLeft = challenge.attempts_left - 1;
    if (attemptsLeft <= 0) {
      await supabase.from('portal_challenges').delete().eq('id', challengeId);
      return res.status(401).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
    }
    await supabase.from('portal_challenges').update({ attempts_left: attemptsLeft }).eq('id', challengeId);
    return res.status(401).json({ error: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.` });
  }

  await supabase.from('portal_challenges').delete().eq('id', challengeId);
  return res.json({
    token: signPortalJWT(challenge.email, challenge.name, {
      companyId: challenge.company_id,
      locationId: challenge.location_id,
    }),
    name: challenge.name,
    email: challenge.email,
  });
});

// GET /api/portal/me
router.get('/me', authenticatePortalToken, (req, res) => {
  res.json({ email: req.customerEmail, name: req.customerName });
});

router.use('/', require('./portal-payments')({ authenticatePortalToken }));
router.use('/', require('./portal-customer')({ authenticatePortalToken }));

module.exports = router;
