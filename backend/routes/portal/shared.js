'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabase } = require('../../services/supabase');
const { createConfiguredMailers } = require('../../services/email');
const { PORTAL_JWT_SECRET } = require('../../lib/config');

const PORTAL_CODE_TTL_MS = Number(process.env.PORTAL_CODE_TTL_MS || 10 * 60 * 1000);
const PORTAL_MAX_VERIFY_ATTEMPTS = Number(process.env.PORTAL_MAX_VERIFY_ATTEMPTS || 5);
const PORTAL_RESEND_COOLDOWN_MS = Number(process.env.PORTAL_RESEND_COOLDOWN_MS || 60 * 1000);
const PORTAL_AUTH_RATE_WINDOW_MS = Number(process.env.PORTAL_AUTH_RATE_WINDOW_MS || 15 * 60 * 1000);
const PORTAL_AUTH_RATE_LIMIT = Number(process.env.PORTAL_AUTH_RATE_LIMIT || 5);
const IS_PROD = (process.env.NODE_ENV || '').toLowerCase() === 'production';
const PORTAL_COOKIE = 'portal_token';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function maskEmailAddress(email) {
  return String(email || '').replace(/(^.).*(@.*$)/, '$1***$2');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const PORTAL_PREVIEW_EMAILS = String(process.env.PORTAL_PREVIEW_EMAILS || '')
  .split(',')
  .map((value) => normalizeEmail(value))
  .filter(Boolean);

function signPortalJWT(email, name, context = {}) {
  return jwt.sign(
    {
      email,
      name,
      role: 'customer',
      companyId: context.companyId || null,
      locationId: context.locationId || null,
    },
    PORTAL_JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function canUsePortalPreview(email) {
  const normalized = normalizeEmail(email);
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!normalized) return false;
  return normalized === adminEmail || PORTAL_PREVIEW_EMAILS.includes(normalized);
}

function portalTenantCandidates(rows = []) {
  return rows
    .map((row) => ({
      row,
      key: `${row.company_id || ''}:${row.location_id || ''}`,
    }))
    .filter((candidate) => candidate.key !== ':');
}

// FIX [H5]: fail closed when one portal email maps to multiple tenant contexts.
function uniquePortalTenantMatch(rows = []) {
  const candidates = portalTenantCandidates(rows);
  if (!candidates.length) return null;
  const tenantKeys = new Set(candidates.map((candidate) => candidate.key));
  if (tenantKeys.size !== 1) return null;
  return candidates[0].row;
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
    .select('customer_name,customer_email,company_id,location_id,created_at')
    .ilike('customer_email', normalized)
    .order('created_at', { ascending: false })
    .limit(10);
  if (invoiceError) throw invoiceError;
  const invoice = uniquePortalTenantMatch(invoices || []);
  if (invoice) {
    return {
      email: normalized,
      name: invoice.customer_name || normalized,
      companyId: invoice.company_id || null,
      locationId: invoice.location_id || null,
    };
  }
  if (invoices && invoices.length > 0) return null;

  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('customer_name,customer_email,company_id,location_id,created_at')
    .ilike('customer_email', normalized)
    .order('created_at', { ascending: false })
    .limit(10);
  if (orderError) throw orderError;
  const order = uniquePortalTenantMatch(orders || []);
  if (order) {
    return {
      email: normalized,
      name: order.customer_name || normalized,
      companyId: order.company_id || null,
      locationId: order.location_id || null,
    };
  }
  if (orders && orders.length > 0) return null;

  const { data: customers } = await supabase
    .from('Customers')
    .select('company_name, billing_email, company_id, location_id')
    .ilike('billing_email', normalized)
    .limit(10);
  const customer = uniquePortalTenantMatch(customers || []);
  if (customer) {
    return {
      email: normalized,
      name: customer.company_name || normalized,
      companyId: customer.company_id || null,
      locationId: customer.location_id || null,
    };
  }
  if (customers && customers.length > 0) return null;

  if (canUsePortalPreview(normalized)) {
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .ilike('email', normalized)
      .limit(1);
    if (userError) throw userError;
    const user = Array.isArray(users) ? users[0] : null;
    return {
      email: normalized,
      name: (user && user.name) || 'Portal Preview',
      companyId: (user && user.company_id) || process.env.DEFAULT_COMPANY_ID || null,
      locationId: (user && user.location_id) || process.env.DEFAULT_LOCATION_ID || null,
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
              <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${escapeHtml(name || 'there')},</p>
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

// Gate for the paid Customer Portal Ordering add-on. Must run AFTER
// authenticatePortalToken so req.portalContext.companyId is populated.
// Returns 403 FEATURE_NOT_ENABLED when the company has not purchased the add-on.
async function requirePortalOrdering(req, res, next) {
  try {
    const companyId = req.portalContext?.companyId || req.portalContext?.activeCompanyId || null;
    if (!companyId) {
      return res.status(403).json({ error: 'Online ordering is not available.', code: 'FEATURE_NOT_ENABLED' });
    }
    const { data, error } = await supabase
      .from('companies')
      .select('portal_ordering_enabled')
      .eq('id', companyId)
      .single();
    if (error || !data || data.portal_ordering_enabled !== true) {
      return res.status(403).json({ error: 'Online ordering is not enabled for this account.', code: 'FEATURE_NOT_ENABLED' });
    }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Online ordering is not enabled for this account.', code: 'FEATURE_NOT_ENABLED' });
  }
}

function extractPortalToken(req) {
  const cookieToken = req.cookies?.[PORTAL_COOKIE];
  if (cookieToken) return cookieToken;

  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function setPortalAuthCookie(res, token) {
  res.cookie(PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearPortalAuthCookie(res) {
  res.clearCookie(PORTAL_COOKIE, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/',
  });
}

function authenticatePortalToken(req, res, next) {
  const token = extractPortalToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, PORTAL_JWT_SECRET);
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

module.exports = {
  PORTAL_CODE_TTL_MS,
  PORTAL_MAX_VERIFY_ATTEMPTS,
  PORTAL_RESEND_COOLDOWN_MS,
  authenticatePortalToken,
  requirePortalOrdering,
  canRequestCode,
  codesMatch,
  clearPortalAuthCookie,
  extractPortalToken,
  generateVerificationCode,
  hashCode,
  maskEmailAddress,
  normalizeEmail,
  pruneExpiredChallenges,
  resolvePortalCustomer,
  sendPortalCodeEmail,
  setPortalAuthCookie,
  signPortalJWT,
  touchRateLimitBucket,
};
