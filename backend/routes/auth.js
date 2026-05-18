const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { getUserOperatingContext, userResponseWithContext } = require('../services/operating-context');
const {
  parseLoginBody,
  parseSignupBody,
  parseSetupPasswordBody,
  parseChangePasswordBody,
} = require('../lib/auth-schemas');
const {
  loginLimiter,
  setupPasswordLimiter,
  changePasswordLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

const { JWT_SECRET } = require('../lib/config');
const JWT_EXPIRY = '24h';
const DRIVER_ACCESS_EXPIRY = '15m';
const DRIVER_REFRESH_EXPIRY = '7d';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 h in ms
const TEMPLATES_PATH = path.join(__dirname, '../../supabase/seeds/inventory_templates.json');

const IS_PROD = process.env.NODE_ENV === 'production';

let _templates = null;

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }

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
  return signUserJWT(user, JWT_EXPIRY, 'session');
}

function signUserJWT(user, expiresIn, tokenType) {
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
    },
    JWT_SECRET,
    { expiresIn }
  );
}

function signDriverTokens(user) {
  return {
    token: signUserJWT(user, DRIVER_ACCESS_EXPIRY, 'driver_access'),
    refreshToken: signUserJWT(user, DRIVER_REFRESH_EXPIRY, 'driver_refresh'),
  };
}

async function findUserByCredentials(email, password) {
  const normalizedEmail = email.toLowerCase();
  const users = await dbQuery(supabase.from('users').select('*'), null);
  const user = (Array.isArray(users) ? users : []).find(
    (candidate) => String(candidate?.email || '').trim().toLowerCase() === normalizedEmail
  );

  if (!user || user.status !== 'active') return { user: null, valid: false, migrate: false };

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
function setAuthCookies(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
  // Readable CSRF token — same session, different cookie
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf-token', csrfToken, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearAuthCookies(res) {
  res.clearCookie('token', { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/' });
  res.clearCookie('csrf-token', { httpOnly: false, secure: IS_PROD, sameSite: 'strict', path: '/' });
}

// POST /auth/login — 5 attempts / 15 min
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = parseLoginBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { email, password } = parsed.data;

  const { user: u, valid, migrate } = await findUserByCredentials(email, password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (migrate) {
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(password, 10) }).eq('id', u.id);
  }
  const token = signJWT(u);
  setAuthCookies(res, token);
  res.json({ user: userResponseWithContext(u) });
});

router.post('/driver/login', loginLimiter, async (req, res) => {
  const parsed = parseLoginBody(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { email, password } = parsed.data;

  const { user: u, valid, migrate } = await findUserByCredentials(email, password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (u.role !== 'driver') return res.status(403).json({ error: 'Forbidden' });
  if (migrate) {
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(password, 10) }).eq('id', u.id);
  }

  const { token, refreshToken } = signDriverTokens(u);
  res.json({ token, refreshToken, user: userResponseWithContext(u) });
});

router.post('/driver/refresh', async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  if (payload?.tokenType !== 'driver_refresh') {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const users = await dbQuery(supabase.from('users').select('*').eq('id', payload.userId || payload.sub).limit(1), res);
  if (!users) return;
  const u = users[0];
  if (!u || u.status !== 'active' || u.role !== 'driver') {
    return res.status(401).json({ error: 'User not found' });
  }

  const tokens = signDriverTokens(u);
  res.json({ ...tokens, user: userResponseWithContext(u) });
});

router.post('/signup', loginLimiter, async (req, res) => {
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

  const { error: configError } = await supabase
    .from('company_config')
    .insert({
      company_id: company.id,
      ...configDefaults,
      updated_at: new Date().toISOString(),
    });

  if (configError) {
    await supabase.from('users').delete().eq('id', createdUser.id);
    await supabase.from('companies').delete().eq('id', company.id);
    return res.status(500).json({ error: configError.message || 'Could not initialize company setup' });
  }

  try {
    if (configDefaults.catalog_setup === 'template' && configDefaults.catalog_template !== 'blank') {
      await seedProductsFromTemplate(company.id, configDefaults.catalog_template);
    }
  } catch (seedError) {
    await supabase.from('company_config').delete().eq('company_id', company.id);
    await supabase.from('users').delete().eq('id', createdUser.id);
    await supabase.from('companies').delete().eq('id', company.id);
    return res.status(500).json({
      error: seedError?.message || 'Could not initialize inventory template',
    });
  }

  const token = signJWT(createdUser);
  setAuthCookies(res, token);
  res.status(201).json({ user: userResponseWithContext(createdUser) });
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
  const sessionToken = signJWT(u);
  setAuthCookies(res, sessionToken);
  res.json({ user: userResponseWithContext(u) });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json(userResponseWithContext(req.user));
});

router.post('/logout', authenticateToken, (req, res) => {
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
