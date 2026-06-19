const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { getUserOperatingContext, userResponseWithContext } = require('../services/operating-context');
const { createConfiguredMailers } = require('../services/email');
const logger = require('../services/logger');
const {
  parseLoginBody,
  parseSignupBody,
  parseSetupPasswordBody,
  parseForgotPasswordBody,
  parseResetPasswordBody,
  parseChangePasswordBody,
} = require('../lib/auth-schemas');
const {
  loginLimiter,
  setupPasswordLimiter,
  passwordResetLimiter,
  changePasswordLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

// Constant-time delay on all auth endpoints — prevents timing-based enumeration.
function authDelay() {
  return new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 200)));
}

const { JWT_SECRET } = require('../lib/config');
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const DRIVER_ACCESS_EXPIRY = '15m';
const DRIVER_REFRESH_EXPIRY = '7d';
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const REFRESH_SESSION_TABLE = 'auth_refresh_sessions';
const TEMPLATES_PATH = path.join(__dirname, '../../supabase/seeds/inventory_templates.json');

const IS_PROD = process.env.NODE_ENV === 'production';
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const EMAIL_SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 5000);
// How long a password reset link stays valid.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

let _templates = null;

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
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

function withEmailTimeout(promise, provider) {
  if (!EMAIL_SEND_TIMEOUT_MS || EMAIL_SEND_TIMEOUT_MS <= 0) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${provider || 'email provider'} timed out`)), EMAIL_SEND_TIMEOUT_MS);
  });
  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeoutPromise]);
}

// Sends the password reset email. Tries each configured provider in order and
// resolves quietly — callers must not surface delivery state to the client, to
// keep /forgot-password enumeration-safe.
async function sendPasswordResetEmail({ name, email, resetUrl }) {
  const mailers = createConfiguredMailers();
  if (!mailers.length) {
    logger.warn({ email: maskEmail(email) }, 'Password reset requested but no email provider is configured');
    return;
  }
  const safeName = escapeHtml(name || 'there');
  for (const mailer of mailers) {
    try {
      await withEmailTimeout(mailer.sendMail({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: 'Reset your NodeRoute password',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#050d2a;padding:24px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#3dba7f;margin:0;font-size:24px">NodeRoute Systems</h1>
            </div>
            <div style="background:#f8faff;padding:32px;border-radius:0 0 12px 12px">
              <h2 style="color:#0d1b3e;margin-bottom:8px">Hi ${safeName},</h2>
              <p style="color:#334;font-size:15px;line-height:1.6">
                We received a request to reset the password for your NodeRoute account.
                Click the button below to choose a new password.
              </p>
              <div style="text-align:center;margin:32px 0">
                <a href="${escapeHtml(resetUrl)}" style="background:#3dba7f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;display:inline-block">
                  Reset Password
                </a>
              </div>
              <p style="color:#667;font-size:13px">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
            </div>
          </div>
        `,
      }), mailer.provider);
      logger.info({ provider: mailer.provider, email: maskEmail(email) }, 'Password reset email sent');
      return;
    } catch (providerErr) {
      logger.error({ provider: mailer.provider, err: providerErr.message }, 'Password reset email delivery failed');
    }
  }
}

function getTemplates() {
  if (!_templates) {
    try {
      _templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    } catch {
      _templates = {};
    }
  }
  return _templates;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('$2')) return { valid: false, migrate: false };
  return { valid: bcrypt.compareSync(pw, stored), migrate: false };
}

function signJWT(user) {
  return signUserJWT(user, ACCESS_TOKEN_EXPIRY, 'access');
}

function signUserJWT(user, expiresIn, tokenType, extraClaims = {}) {
  const context = getUserOperatingContext(user);
  const userId = user?.id;
  return jwt.sign(
    {
      userId,
      id: userId,
      sub: userId,
      email: user.email,
      role: user.role,
      companyId: context.companyId,
      locationId: context.locationId,
      platformRole: context.platformRole,
      tokenType,
      ...extraClaims,
    },
    JWT_SECRET,
    { expiresIn }
  );
}

async function issueDriverTokens(user) {
  const sessionId = crypto.randomUUID();
  const refreshToken = signUserJWT(user, DRIVER_REFRESH_EXPIRY, 'driver_refresh', { sessionId });
  const { error } = await supabase.from(REFRESH_SESSION_TABLE).insert({
    id: sessionId,
    user_id: user.id,
    token_hash: hashRefreshToken(refreshToken),
    expires_at: refreshExpiresAt().toISOString(),
  });
  if (error) throw error;
  return {
    token: signUserJWT(user, DRIVER_ACCESS_EXPIRY, 'driver_access'),
    refreshToken,
    sessionId,
  };
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function refreshExpiresAt() {
  return new Date(Date.now() + REFRESH_COOKIE_MAX_AGE);
}

async function createRefreshSession(user) {
  const sessionId = crypto.randomUUID();
  const refreshToken = signUserJWT(user, REFRESH_TOKEN_EXPIRY, 'refresh', { sessionId });
  const { error } = await supabase.from(REFRESH_SESSION_TABLE).insert({
    id: sessionId,
    user_id: user.id,
    token_hash: hashRefreshToken(refreshToken),
    expires_at: refreshExpiresAt().toISOString(),
  });
  if (error) throw error;
  return { refreshToken, sessionId };
}

function isMissingRefreshSessionStore(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    (
      message.includes(REFRESH_SESSION_TABLE) &&
      /schema cache|does not exist|relation/i.test(message)
    )
  );
}

function isMissingRelationError(error, relationName) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  const relation = String(relationName || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    (
      relation &&
      message.toLowerCase().includes(relation) &&
      /schema cache|does not exist|relation/i.test(message)
    )
  );
}

function sendRefreshSessionStoreError(res, error) {
  if (!isMissingRefreshSessionStore(error)) throw error;
  return res.status(503).json({
    error: 'Authentication session store is not initialized. Run supabase/migrations/20260528_security_auth_refresh_sessions.sql.',
  });
}

async function revokeRefreshSession(refreshToken) {
  if (!refreshToken) return;
  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET);
    if (payload?.tokenType !== 'refresh' || !payload?.sessionId) return;
    await supabase
      .from(REFRESH_SESSION_TABLE)
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', payload.sessionId)
      .eq('token_hash', hashRefreshToken(refreshToken))
      .is('revoked_at', null);
  } catch {
    // Invalid or expired refresh tokens are already unusable; still clear cookies.
  }
}

async function rotateRefreshSession(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET);
  } catch {
    const err = new Error('Invalid or expired refresh token');
    err.status = 401;
    throw err;
  }
  if (payload?.tokenType !== 'refresh' || !payload?.sessionId) {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  const { data: session, error: sessionError } = await supabase
    .from(REFRESH_SESSION_TABLE)
    .select('*')
    .eq('id', payload.sessionId)
    .eq('user_id', payload.userId || payload.sub)
    .single();

  if (sessionError || !session) {
    const err = new Error('Refresh session not found');
    err.status = 401;
    throw err;
  }
  if (session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || session.token_hash !== hashRefreshToken(refreshToken)) {
    const err = new Error('Refresh session revoked');
    err.status = 401;
    throw err;
  }

  const users = await dbQuery(supabase.from('users').select('*').eq('id', payload.userId || payload.sub).limit(1), null);
  const user = users?.[0];
  if (!user || user.status !== 'active') {
    const err = new Error('User not found');
    err.status = 401;
    throw err;
  }

  const next = await createRefreshSession(user);
  await supabase
    .from(REFRESH_SESSION_TABLE)
    .update({
      revoked_at: new Date().toISOString(),
      replaced_by: next.sessionId,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .is('revoked_at', null);

  return { accessToken: signJWT(user), refreshToken: next.refreshToken, user };
}

async function rotateDriverRefreshSession(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET);
  } catch {
    const err = new Error('Invalid or expired refresh token');
    err.status = 401;
    throw err;
  }
  if (payload?.tokenType !== 'driver_refresh' || !payload?.sessionId) {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  const { data: session, error: sessionError } = await supabase
    .from(REFRESH_SESSION_TABLE)
    .select('*')
    .eq('id', payload.sessionId)
    .eq('user_id', payload.userId || payload.sub)
    .single();

  if (sessionError || !session) {
    const err = new Error('Refresh session not found');
    err.status = 401;
    throw err;
  }
  if (session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || session.token_hash !== hashRefreshToken(refreshToken)) {
    const err = new Error('Refresh session revoked');
    err.status = 401;
    throw err;
  }

  const users = await dbQuery(supabase.from('users').select('*').eq('id', payload.userId || payload.sub).limit(1), null);
  const user = users?.[0];
  if (!user || user.status !== 'active' || user.role !== 'driver') {
    const err = new Error('User not found');
    err.status = 401;
    throw err;
  }

  const next = await issueDriverTokens(user);
  await supabase
    .from(REFRESH_SESSION_TABLE)
    .update({
      revoked_at: new Date().toISOString(),
      replaced_by: next.sessionId,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .is('revoked_at', null);

  return { token: next.token, refreshToken: next.refreshToken, user };
}

async function findUserByCredentials(email, password) {
  const normalizedEmail = email.toLowerCase().trim();
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', normalizedEmail)
    .single();

  if (error || !user || user.status !== 'active') return { user: null, valid: false, migrate: false };

  const passwordResult = verifyPassword(password, user.password_hash);
  if (!passwordResult.valid) return { user: null, valid: false, migrate: false };
  return { user, valid: true, migrate: passwordResult.migrate };
}

function slugifyCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'company';
}

function companyConfigDefaultsFromSignup(distributorType, inventoryChoice, selectedTemplate) {
  const vertical = distributorType === 'wine' || distributorType === 'beer'
    ? 'liquor'
    : distributorType === 'food'
      ? 'broadline'
      : distributorType;

  const template = inventoryChoice === 'template'
    ? (selectedTemplate === 'broadline' ? 'broadline' : vertical)
    : 'blank';

  const businessTypes = vertical === 'broadline' ? ['broadline'] : [vertical];
  const enabledUnits = (() => {
    if (vertical === 'seafood') return ['lb', 'catch_weight', 'case'];
    if (vertical === 'liquor') return ['each', 'case', 'pallet'];
    if (vertical === 'broadline') return ['each', 'case', 'lb', 'catch_weight', 'gallon', 'pallet'];
    return ['each', 'case'];
  })();

  return {
    business_types: businessTypes,
    enabled_units: enabledUnits,
    feat_catch_weight: vertical === 'seafood',
    feat_fsma_lot_tracking: vertical === 'seafood' || vertical === 'broadline',
    feat_cold_chain_notes: vertical === 'seafood' || vertical === 'broadline',
    feat_alcohol_compliance: vertical === 'liquor',
    feat_deposit_tracking: vertical === 'liquor',
    feat_case_to_each: vertical === 'broadline',
    catalog_template: template,
    catalog_setup: inventoryChoice === 'import' ? 'csv' : inventoryChoice,
    onboarding_completed: true,
  };
}

async function buildUniqueCompanySlug(name) {
  const base = slugifyCompanyName(name);
  const existing = await dbQuery(supabase.from('companies').select('slug'), null);
  const taken = new Set((Array.isArray(existing) ? existing : []).map((company) => String(company?.slug || '').toLowerCase()));
  if (!taken.has(base)) return base;

  let attempt = 2;
  while (taken.has(`${base}-${attempt}`)) attempt += 1;
  return `${base}-${attempt}`;
}

async function seedProductsFromTemplate(companyId, templateKey) {
  if (!templateKey || templateKey === 'blank') return 0;

  const templates = getTemplates();
  const products = templates[templateKey] ?? [];
  if (!products.length) return 0;

  const rows = products.map((product) => ({
    company_id: companyId,
    item_number: product.item_number,
    name: product.name,
    category: product.category ?? 'General',
    default_unit: product.default_unit ?? 'each',
    unit: product.unit ?? product.default_unit ?? 'each',
    case_qty: product.case_qty ?? null,
    cost: product.cost ?? 0,
    price_per_unit: product.price_per_unit ?? product.cost ?? 0,
    is_catch_weight: product.is_catch_weight ?? false,
    is_ftl_regulated: product.is_ftl_regulated ?? false,
    is_deposit_item: product.is_deposit_item ?? false,
    deposit_amount: product.deposit_amount ?? null,
    requires_age_verification: product.requires_age_verification ?? false,
    temp_sensitive: product.temp_sensitive ?? false,
    lot_item: product.is_ftl_regulated ? 'Y' : 'N',
    on_hand_qty: 0,
    on_hand_weight: 0,
    is_active: true,
  }));

  const { data, error } = await supabase.from('products').insert(rows).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Sets the HttpOnly auth cookie and a readable CSRF token cookie.
 * The CSRF cookie is NOT HttpOnly so the frontend JS can read it
 * and send it back as the X-CSRF-Token header on mutations.
 */
function setSessionCookies(res, accessToken, refreshToken) {
  res.cookie('token', accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: ACCESS_COOKIE_MAX_AGE,
    path: '/',
  });
  res.cookie('refresh-token', refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/',
  });
  // Readable CSRF token — same session, different cookie
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf-token', csrfToken, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: ACCESS_COOKIE_MAX_AGE,
    path: '/',
  });
}

async function setAuthCookies(res, user) {
  const { refreshToken } = await createRefreshSession(user);
  setSessionCookies(res, signJWT(user), refreshToken);
}

function clearAuthCookies(res) {
  res.clearCookie('token', { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/' });
  res.clearCookie('refresh-token', { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/' });
  res.clearCookie('csrf-token', { httpOnly: false, secure: IS_PROD, sameSite: 'strict', path: '/' });
}

// POST /auth/login — 5 attempts / 15 min
router.post('/login', loginLimiter, async (req, res) => {
  await authDelay();
  const parsed = parseLoginBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { email, password } = parsed.data;

  const { user: u, valid } = await findUserByCredentials(email, password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  try {
    await setAuthCookies(res, u);
  } catch (error) {
    return sendRefreshSessionStoreError(res, error);
  }
  res.json({ user: userResponseWithContext(u) });
});

router.post('/driver/login', loginLimiter, async (req, res) => {
  await authDelay();
  const parsed = parseLoginBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { email, password } = parsed.data;

  const { user: u, valid } = await findUserByCredentials(email, password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (u.role !== 'driver') return res.status(403).json({ error: 'Forbidden' });

  let token;
  let refreshToken;
  try {
    const tokens = await issueDriverTokens(u);
    token = tokens.token;
    refreshToken = tokens.refreshToken;
    await setAuthCookies(res, u);
  } catch (error) {
    return sendRefreshSessionStoreError(res, error);
  }
  res.json({ token, refreshToken, user: userResponseWithContext(u) });
});

router.post('/driver/refresh', async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const rotated = await rotateDriverRefreshSession(refreshToken);
    res.json({
      token: rotated.token,
      refreshToken: rotated.refreshToken,
      user: userResponseWithContext(rotated.user),
    });
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message || 'Invalid refresh token' });
  }
});

router.post('/signup', loginLimiter, async (req, res) => {
  await authDelay();
  const parsed = parseSignupBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const {
    email,
    password,
    firstName,
    lastName,
    businessName,
    phone,
    address,
    city,
    state,
    zip,
    distributorType,
    inventoryChoice,
    selectedTemplate,
  } = parsed.data;

  const normalizedEmail = email.toLowerCase();
  const fullName = `${firstName} ${lastName}`.trim();

  const users = await dbQuery(supabase.from('users').select('id, email'), res);
  if (!users) return;

  const emailTaken = (Array.isArray(users) ? users : []).some(
    (user) => String(user?.email || '').trim().toLowerCase() === normalizedEmail
  );
  if (emailTaken) return res.status(409).json({ error: 'An account with that email already exists' });

  const companySlug = await buildUniqueCompanySlug(businessName);
  const companyPayload = {
    name: businessName,
    slug: companySlug,
    plan: 'starter',
    status: 'trial',
    phone: phone || null,
    address: address || null,
    city,
    state: state.toUpperCase(),
    zip: zip || null,
  };

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert(companyPayload)
    .select('id')
    .single();

  if (companyError || !company?.id) {
    return res.status(500).json({ error: companyError?.message || 'Could not create company' });
  }

  const userId = crypto.randomUUID();
  const userPayload = {
    id: userId,
    name: fullName,
    email: normalizedEmail,
    password_hash: hashPassword(password),
    role: 'admin',
    status: 'active',
    company_id: company.id,
    phone: phone || null,
  };

  const { data: createdUser, error: userError } = await supabase
    .from('users')
    .insert(userPayload)
    .select('*')
    .single();

  if (userError || !createdUser) {
    await supabase.from('companies').delete().eq('id', company.id);
    return res.status(500).json({ error: userError?.message || 'Could not create user' });
  }

  const configDefaults = companyConfigDefaultsFromSignup(distributorType, inventoryChoice, selectedTemplate);
  let setupWarning = null;

  const { error: configError } = await supabase
    .from('company_config')
    .insert({
      company_id: company.id,
      ...configDefaults,
      updated_at: new Date().toISOString(),
    });

  if (configError) {
    if (isMissingRelationError(configError, 'company_config')) {
      setupWarning = 'Company setup defaults were skipped because the company_config migration has not been applied.';
      console.warn('[signup] company_config missing; continuing account creation without setup defaults');
    } else {
      await supabase.from('users').delete().eq('id', createdUser.id);
      await supabase.from('companies').delete().eq('id', company.id);
      return res.status(500).json({ error: configError.message || 'Could not initialize company setup' });
    }
  }

  try {
    if (configDefaults.catalog_setup === 'template' && configDefaults.catalog_template !== 'blank') {
      await seedProductsFromTemplate(company.id, configDefaults.catalog_template);
    }
  } catch (seedError) {
    if (isMissingRelationError(seedError, 'products')) {
      setupWarning = setupWarning || 'Inventory template seeding was skipped because the products migration has not been applied.';
      console.warn('[signup] products missing; continuing account creation without inventory template');
    } else {
      await supabase.from('company_config').delete().eq('company_id', company.id);
      await supabase.from('users').delete().eq('id', createdUser.id);
      await supabase.from('companies').delete().eq('id', company.id);
      return res.status(500).json({
        error: seedError?.message || 'Could not initialize inventory template',
      });
    }
  }

  try {
    await setAuthCookies(res, createdUser);
  } catch (error) {
    return sendRefreshSessionStoreError(res, error);
  }
  res.status(201).json({ user: userResponseWithContext(createdUser), setupWarning });
});

// POST /auth/setup-password — 10 attempts / hour
router.post('/setup-password', setupPasswordLimiter, async (req, res) => {
  const parsed = parseSetupPasswordBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { token, password } = parsed.data;
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
  try {
    await setAuthCookies(res, u);
  } catch (error) {
    return sendRefreshSessionStoreError(res, error);
  }
  res.json({ user: userResponseWithContext(u) });
});

// POST /auth/forgot-password — 5 attempts / 15 min.
// Always returns the same generic response so the endpoint can't be used to
// probe which emails have accounts.
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  await authDelay();
  const parsed = parseForgotPasswordBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const email = parsed.data.email.toLowerCase().trim();

  const genericResponse = { message: 'If an account exists for that email, a password reset link has been sent.' };

  try {
    const { data: user } = await supabase.from('users').select('id, name, email, status').eq('email', email).single();
    if (user && user.status === 'active') {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
      await supabase.from('users').update({ reset_token: hashResetToken(rawToken), reset_expires: expires }).eq('id', user.id);

      const resetUrl = `${BASE_URL}/reset-password?token=${rawToken}`;
      // Fire-and-forget so response timing doesn't depend on the mail provider.
      void sendPasswordResetEmail({ name: user.name, email: user.email, resetUrl });
      logger.info({ email: maskEmail(email) }, 'Password reset requested');
    }
  } catch (err) {
    // Never leak failures to the caller — log and still return the generic response.
    logger.error({ err: err.message }, 'forgot-password processing failed');
  }

  return res.json(genericResponse);
});

// POST /auth/reset-password — 5 attempts / 15 min.
// Consumes a reset token, sets the new password, revokes existing sessions, and
// signs the user in.
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  await authDelay();
  const parsed = parseResetPasswordBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { token, password } = parsed.data;

  const users = await dbQuery(supabase.from('users').select('*').eq('reset_token', hashResetToken(token)).limit(1), res);
  if (!users) return;
  const u = users[0];
  if (!u || !u.reset_expires || new Date() > new Date(u.reset_expires)) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  await supabase.from('users').update({
    password_hash: hashPassword(password),
    status: 'active',
    reset_token: null,
    reset_expires: null,
  }).eq('id', u.id);

  // Revoke any live sessions so an attacker who had access can't ride through the reset.
  try {
    await supabase.from(REFRESH_SESSION_TABLE)
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', u.id)
      .is('revoked_at', null);
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not revoke sessions during password reset');
  }

  try {
    await setAuthCookies(res, u);
  } catch (error) {
    return sendRefreshSessionStoreError(res, error);
  }
  res.json({ user: userResponseWithContext(u) });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json(userResponseWithContext(req.user));
});

router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.['refresh-token'];
  if (!refreshToken) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Refresh token required' });
  }

  try {
    const rotated = await rotateRefreshSession(refreshToken);
    setSessionCookies(res, rotated.accessToken, rotated.refreshToken);
    return res.json({ user: userResponseWithContext(rotated.user) });
  } catch (error) {
    clearAuthCookies(res);
    return res.status(error.status || 401).json({ error: error.message || 'Invalid refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  await revokeRefreshSession(req.cookies?.['refresh-token']);
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
});

// POST /auth/change-password — 5 attempts / 15 min
router.post('/change-password', authenticateToken, changePasswordLimiter, async (req, res) => {
  const parsed = parseChangePasswordBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { currentPassword, newPassword } = parsed.data;
  const { data: user, error } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });
  const { valid } = verifyPassword(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  await supabase.from('users').update({ password_hash: bcrypt.hashSync(newPassword, 10) }).eq('id', req.user.id);
  res.json({ message: 'Password updated' });
});

module.exports = router;
