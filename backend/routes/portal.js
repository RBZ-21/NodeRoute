const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabase } = require('../services/supabase');
const { buildInvoicePDF } = require('../services/pdf');
const { createConfiguredMailers } = require('../services/email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';
const PORTAL_CODE_TTL_MS = Number(process.env.PORTAL_CODE_TTL_MS || 10 * 60 * 1000);
const PORTAL_MAX_VERIFY_ATTEMPTS = Number(process.env.PORTAL_MAX_VERIFY_ATTEMPTS || 5);
const PORTAL_RESEND_COOLDOWN_MS = Number(process.env.PORTAL_RESEND_COOLDOWN_MS || 60 * 1000);
const PORTAL_AUTH_RATE_WINDOW_MS = Number(process.env.PORTAL_AUTH_RATE_WINDOW_MS || 15 * 60 * 1000);
const PORTAL_AUTH_RATE_LIMIT = Number(process.env.PORTAL_AUTH_RATE_LIMIT || 5);
const portalChallenges = new Map();
const authAttempts = new Map();

function signPortalJWT(email, name) {
  return jwt.sign({ email, name, role: 'customer' }, JWT_SECRET, { expiresIn: '24h' });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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

function pruneExpiredChallenges() {
  const now = Date.now();
  for (const [challengeId, challenge] of portalChallenges.entries()) {
    if (challenge.expiresAt <= now) portalChallenges.delete(challengeId);
  }
}

function touchRateLimitBucket(email) {
  const now = Date.now();
  const key = normalizeEmail(email);
  const bucket = authAttempts.get(key) || [];
  const fresh = bucket.filter((timestamp) => now - timestamp < PORTAL_AUTH_RATE_WINDOW_MS);
  fresh.push(now);
  authAttempts.set(key, fresh);
  return fresh.length;
}

function canRequestCode(email) {
  const key = normalizeEmail(email);
  const bucket = authAttempts.get(key) || [];
  const now = Date.now();
  const fresh = bucket.filter((timestamp) => now - timestamp < PORTAL_AUTH_RATE_WINDOW_MS);
  authAttempts.set(key, fresh);
  return fresh.length < PORTAL_AUTH_RATE_LIMIT;
}

async function resolvePortalCustomer(email) {
  const normalized = normalizeEmail(email);
  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('customer_name')
    .ilike('customer_email', normalized)
    .limit(1);
  if (invoiceError) throw invoiceError;
  if (invoices && invoices.length > 0) {
    return { email: normalized, name: invoices[0].customer_name || normalized };
  }

  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('customer_name')
    .ilike('customer_email', normalized)
    .limit(1);
  if (orderError) throw orderError;
  if (orders && orders.length > 0) {
    return { email: normalized, name: orders[0].customer_name || normalized };
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
  next();
}

// POST /api/portal/auth — send a short-lived verification code to the customer email
router.post('/auth', async (req, res) => {
  pruneExpiredChallenges();

  const normalized = normalizeEmail(req.body?.email);
  if (!normalized) return res.status(400).json({ error: 'Email required' });
  if (!canRequestCode(normalized)) {
    return res.status(429).json({ error: 'Too many portal login attempts. Please wait a few minutes and try again.' });
  }

  try {
    const customer = await resolvePortalCustomer(normalized);
    if (!customer) {
      touchRateLimitBucket(normalized);
      return res.status(404).json({ error: 'No account found for that email. Contact your NodeRoute representative.' });
    }

    const existing = [...portalChallenges.values()].find((challenge) => challenge.email === normalized);
    if (existing && Date.now() - existing.lastSentAt < PORTAL_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((PORTAL_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000);
      return res.status(429).json({
        error: 'A verification code was just sent. Please wait a moment before requesting another one.',
        retryAfterSeconds,
      });
    }

    const challengeId = crypto.randomBytes(24).toString('hex');
    const code = generateVerificationCode();
    const challenge = {
      id: challengeId,
      email: customer.email,
      name: customer.name,
      codeHash: hashCode(challengeId, code),
      expiresAt: Date.now() + PORTAL_CODE_TTL_MS,
      attemptsLeft: PORTAL_MAX_VERIFY_ATTEMPTS,
      lastSentAt: Date.now(),
    };

    if (existing) portalChallenges.delete(existing.id);
    await sendPortalCodeEmail({ email: customer.email, name: customer.name, code });
    portalChallenges.set(challengeId, challenge);
    touchRateLimitBucket(normalized);

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
  pruneExpiredChallenges();

  const challengeId = String(req.body?.challengeId || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!challengeId || !code) return res.status(400).json({ error: 'Challenge ID and verification code are required' });

  const challenge = portalChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    if (challenge) portalChallenges.delete(challengeId);
    return res.status(401).json({ error: 'This verification code has expired. Please request a new one.' });
  }

  if (!codesMatch(challenge.codeHash, hashCode(challengeId, code))) {
    challenge.attemptsLeft -= 1;
    if (challenge.attemptsLeft <= 0) {
      portalChallenges.delete(challengeId);
      return res.status(401).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
    }
    return res.status(401).json({ error: `Incorrect code. ${challenge.attemptsLeft} attempt${challenge.attemptsLeft === 1 ? '' : 's'} remaining.` });
  }

  portalChallenges.delete(challengeId);
  return res.json({
    token: signPortalJWT(challenge.email, challenge.name),
    name: challenge.name,
    email: challenge.email,
  });
});

// GET /api/portal/me
router.get('/me', authenticatePortalToken, (req, res) => {
  res.json({ email: req.customerEmail, name: req.customerName });
});

// GET /api/portal/orders
router.get('/orders', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_name, customer_address, items, status, notes, created_at, driver_name')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/portal/invoices
router.get('/invoices', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_name, customer_address, items, subtotal, tax, total, status, driver_name, created_at, signed_at, sent_at')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/portal/invoices/:id/pdf — scoped to the authenticated customer's email
router.get('/invoices/:id/pdf', authenticatePortalToken, async (req, res) => {
  const { data: inv, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', req.params.id)
    .ilike('customer_email', req.customerEmail)
    .single();
  if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });
  const pdfBuffer = await buildInvoicePDF(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_number || inv.id.slice(0, 8)}.pdf"`);
  res.send(pdfBuffer);
});

// GET /api/portal/contact — return contact info from portal_contacts or most recent invoice
router.get('/contact', authenticatePortalToken, async (req, res) => {
  const { data: saved } = await supabase
    .from('portal_contacts')
    .select('email, name, phone, address, company, door_code, updated_at')
    .eq('email', req.customerEmail)
    .single();

  if (saved) return res.json(saved);

  // Fall back to most recent invoice data
  const { data: inv } = await supabase
    .from('invoices')
    .select('customer_name, customer_address')
    .ilike('customer_email', req.customerEmail)
    .order('created_at', { ascending: false })
    .limit(1);

  res.json({
    email: req.customerEmail,
    name: (inv && inv[0]) ? inv[0].customer_name : req.customerName,
    address: (inv && inv[0]) ? inv[0].customer_address : null,
    phone: null,
    company: null,
  });
});

// PATCH /api/portal/contact — upsert contact info into portal_contacts
router.patch('/contact', authenticatePortalToken, async (req, res) => {
  const { name, phone, address, company } = req.body;
  const { error } = await supabase
    .from('portal_contacts')
    .upsert([{
      email: req.customerEmail,
      name: name || req.customerName,
      phone: phone || null,
      address: address || null,
      company: company || null,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'email' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Contact information saved' });
});

// PATCH /api/portal/doorcode — customer saves their door/access code
router.patch('/doorcode', authenticatePortalToken, async (req, res) => {
  const { door_code } = req.body;
  const code = (door_code || '').trim() || null;

  // Update portal_contacts — preserve existing fields
  const { data: existing } = await supabase
    .from('portal_contacts')
    .select('*')
    .eq('email', req.customerEmail)
    .single();

  if (existing) {
    await supabase
      .from('portal_contacts')
      .update({ door_code: code, updated_at: new Date().toISOString() })
      .eq('email', req.customerEmail);
  } else {
    await supabase
      .from('portal_contacts')
      .insert([{ email: req.customerEmail, name: req.customerName, door_code: code, updated_at: new Date().toISOString() }]);
  }

  // Best-effort: sync to matching stop row by name
  const lookupName = (existing && existing.name) || req.customerName;
  if (lookupName) {
    await supabase
      .from('stops')
      .update({ door_code: code })
      .ilike('name', lookupName);
  }

  res.json({ message: 'Door code saved' });
});

// GET /api/portal/inventory — in-stock seafood items, newest first
router.get('/inventory', authenticatePortalToken, async (req, res) => {
  const { data, error } = await supabase
    .from('seafood_inventory')
    .select('description, category, unit, on_hand_qty, on_hand_weight, cost, updated_at, created_at')
    .gt('on_hand_qty', 0)
    .order('updated_at', { ascending: false, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
