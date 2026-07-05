'use strict';

const express = require('express');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateEffectiveMonthlyCents,
  calculateEffectiveSetupCents,
  loadCompanyBilling,
  normalizeBillingPayload,
  saveCompanyBilling,
} = require('../services/superadmin-billing');
const { planLimitsFor } = require('../services/plan-limits');

function clearSupabaseTestCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`)
      || key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function clearBillingModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`)
      || key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`)
      || key.includes(`${path.sep}backend${path.sep}routes${path.sep}superadmin.js`)
      || key.includes(`${path.sep}backend${path.sep}routes${path.sep}superadmin-billing.js`)
      || key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withDemoSupabase(run) {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    PORTAL_JWT_SECRET: process.env.PORTAL_JWT_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-superadmin-billing-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'BillingSecret!123';
  process.env.SESSION_SECRET = 'BillingSession!123';
  process.env.PORTAL_JWT_SECRET = 'BillingPortal!123';
  process.env.SUPABASE_URL = 'https://example.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  clearSupabaseTestCache();

  try {
    const { supabase } = require('../services/supabase');
    await run(supabase);
  } finally {
    clearSupabaseTestCache();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

async function seedBillingCatalog(supabase, {
  companyId = 'company-1',
  companyStatus = 'active',
  companyPlan = 'track',
  featureInclusion = 'yes',
} = {}) {
  await supabase.from('companies').insert({
    id: companyId,
    name: 'Acme Seafood',
    slug: `acme-seafood-${companyId}`,
    status: companyStatus,
    plan: companyPlan,
  });
  await supabase.from('platform_plan_tiers').insert([
    { code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 },
    { code: 'erp', name: 'ERP', display_order: 20, monthly_price_cents: 249900, setup_price_cents: 750000 },
  ]);
  await supabase.from('platform_plan_features').insert([
    { code: 'driver_pwa', name: 'Driver PWA', category: 'delivery', description: '', display_order: 10 },
  ]);
  await supabase.from('platform_plan_feature_matrix').insert([
    { tier_code: 'track', feature_code: 'driver_pwa', inclusion: featureInclusion },
    { tier_code: 'erp', feature_code: 'driver_pwa', inclusion: 'full' },
  ]);
  await supabase.from('platform_addons').insert([
    {
      code: 'extra_driver',
      name: 'Extra Driver',
      base_monthly_cents: 3900,
      default_setup_cents: null,
      usage_terms: 'Per driver per month',
      eligible_tier_codes: ['track', 'erp'],
      when_to_sell: '',
      pricing_rationale: '',
      quote_only: false,
      display_order: 10,
    },
  ]);
}

function makeBillingPayload(overrides = {}) {
  return {
    plan_tier_code: 'erp',
    billing_status: 'active',
    billing_interval: 'monthly',
    custom_pricing_enabled: true,
    custom_monthly_price_cents: 300000,
    custom_setup_price_cents: 700000,
    annual_discount_bps: 0,
    contract_start_date: '2026-07-04',
    contract_end_date: '2027-07-04',
    pricing_notes: 'Custom enterprise rollout',
    feature_overrides: [
      {
        feature_code: 'driver_pwa',
        enabled: true,
        inclusion: 'custom',
        notes: 'Enabled by sales',
      },
    ],
    addons: [
      {
        addon_code: 'extra_driver',
        enabled: true,
        quantity: 2,
        monthly_price_cents: 3900,
        setup_price_cents: null,
        usage_terms: 'Per driver per month',
        notes: 'Expansion seats',
      },
    ],
    ...overrides,
  };
}

function withAuditInsertError(db, error) {
  return {
    from(table) {
      const query = db.from(table);
      if (table !== 'platform_pricing_audit_events') return query;

      return new Proxy(query, {
        get(target, prop, receiver) {
          if (prop === 'insert') {
            return () => Promise.resolve({ data: null, error });
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

test('superadmin billing calculations use custom pricing and enabled add-ons', () => {
  const profile = {
    custom_pricing_enabled: true,
    custom_monthly_price_cents: 125000,
    custom_setup_price_cents: 200000,
  };
  const tier = { monthly_price_cents: 79900, setup_price_cents: 150000 };
  const addons = [
    { enabled: true, quantity: 2, monthly_price_cents: 3900, setup_price_cents: null },
    { enabled: false, quantity: 1, monthly_price_cents: 49900, setup_price_cents: null },
  ];

  assert.equal(calculateEffectiveMonthlyCents({ profile, tier, addons }), 132800);
  assert.equal(calculateEffectiveSetupCents({ profile, tier, addons }), 200000);
});

test('superadmin billing payload rejects invalid tier codes and negative prices', () => {
  assert.throws(() => normalizeBillingPayload({
    plan_tier_code: 'starter',
    billing_status: 'active',
    billing_interval: 'monthly',
    custom_pricing_enabled: true,
    custom_monthly_price_cents: -1,
    custom_setup_price_cents: 0,
    annual_discount_bps: 0,
    contract_start_date: null,
    contract_end_date: null,
    pricing_notes: '',
    feature_overrides: [],
    addons: [],
  }), /plan_tier_code/);
});

test('superadmin billing payload rejects negative custom monthly prices independently of tier validation', () => {
  assert.throws(() => normalizeBillingPayload({
    plan_tier_code: 'erp',
    billing_status: 'active',
    billing_interval: 'monthly',
    custom_pricing_enabled: true,
    custom_monthly_price_cents: -1,
    custom_setup_price_cents: 0,
    annual_discount_bps: 0,
    contract_start_date: null,
    contract_end_date: null,
    pricing_notes: '',
    feature_overrides: [],
    addons: [],
  }), /custom_monthly_price_cents/);
});

test('plan limits match workbook pricing tiers and legacy aliases', () => {
  const trialLimits = {
    plan: 'trial',
    maxDrivers: 2,
    maxDeliveriesPerMonth: 500,
  };
  const trackLimits = {
    plan: 'track',
    maxDrivers: 2,
    maxDeliveriesPerMonth: 500,
  };
  const dispatchLimits = {
    plan: 'dispatch',
    maxDrivers: 5,
    maxDeliveriesPerMonth: 2500,
  };
  const operationsLimits = {
    plan: 'operations',
    maxDrivers: 10,
    maxDeliveriesPerMonth: 5000,
  };
  const erpLimits = {
    plan: 'erp',
    maxDrivers: 15,
    maxDeliveriesPerMonth: 10000,
  };
  const enterpriseLimits = {
    plan: 'enterprise',
    maxDrivers: 25,
    maxDeliveriesPerMonth: 20000,
  };

  assert.deepEqual(planLimitsFor({ plan: 'trial' }), trialLimits);
  assert.deepEqual(planLimitsFor({ plan: 'track' }), trackLimits);
  assert.deepEqual(planLimitsFor({ plan: 'dispatch' }), dispatchLimits);
  assert.deepEqual(planLimitsFor({ plan: 'operations' }), operationsLimits);
  assert.deepEqual(planLimitsFor({ plan: 'erp' }), erpLimits);
  assert.deepEqual(planLimitsFor({ plan: 'enterprise' }), enterpriseLimits);
  assert.deepEqual(planLimitsFor({ plan: 'free' }), trackLimits);
  assert.deepEqual(planLimitsFor({ plan: 'starter' }), trackLimits);
  assert.deepEqual(planLimitsFor({ plan: 'growth' }), operationsLimits);
  assert.deepEqual(planLimitsFor({ plan: 'pro' }), erpLimits);
  assert.deepEqual(planLimitsFor({ plan: 'unknown-tier' }), trackLimits);
  assert.deepEqual(planLimitsFor({ plan: '' }), trackLimits);
  assert.deepEqual(planLimitsFor(null), trackLimits);
});

test('discounted add-on feature inclusions stay disabled until explicitly enabled', async () => {
  await withDemoSupabase(async (supabase) => {
    await seedBillingCatalog(supabase, { featureInclusion: 'discounted_add_on' });

    const result = await loadCompanyBilling(supabase, 'company-1');

    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].feature_code, 'driver_pwa');
    assert.equal(result.features[0].inclusion, 'discounted_add_on');
    assert.equal(result.features[0].enabled, false);
    assert.equal(result.features[0].source, 'tier');
  });
});

test('saveCompanyBilling maps cancelled billing status onto a suspended company status', async () => {
  await withDemoSupabase(async (supabase) => {
    await seedBillingCatalog(supabase);

    const result = await saveCompanyBilling(
      supabase,
      'company-1',
      makeBillingPayload({ billing_status: 'cancelled' }),
      { id: 'superadmin-1' },
    );

    assert.equal(result.profile.billing_status, 'cancelled');
    assert.equal(result.company.status, 'suspended');
    assert.equal(result.company.plan, 'erp');
  });
});

test('saveCompanyBilling clears removed feature overrides and add-ons', async () => {
  await withDemoSupabase(async (supabase) => {
    await seedBillingCatalog(supabase);

    await saveCompanyBilling(
      supabase,
      'company-1',
      makeBillingPayload(),
      { id: 'superadmin-1' },
    );

    const cleared = await saveCompanyBilling(
      supabase,
      'company-1',
      makeBillingPayload({
        custom_pricing_enabled: false,
        custom_monthly_price_cents: null,
        custom_setup_price_cents: null,
        feature_overrides: [],
        addons: [],
      }),
      { id: 'superadmin-1' },
    );

    const { data: featureRows } = await supabase
      .from('company_feature_entitlements')
      .select('*')
      .eq('company_id', 'company-1');
    const { data: addonRows } = await supabase
      .from('company_addon_entitlements')
      .select('*')
      .eq('company_id', 'company-1');

    assert.equal(featureRows.length, 0);
    assert.equal(addonRows.length, 0);
    assert.equal(cleared.features[0].source, 'tier');
    assert.equal(cleared.features[0].enabled, true);
    assert.equal(cleared.addons[0].enabled, false);
  });
});

test('saveCompanyBilling throws when audit insertion fails', async () => {
  await withDemoSupabase(async (supabase) => {
    await seedBillingCatalog(supabase);

    await assert.rejects(
      saveCompanyBilling(
        withAuditInsertError(supabase, new Error('audit insert failed')),
        'company-1',
        makeBillingPayload(),
        { id: 'superadmin-1' },
      ),
      /audit insert failed/,
    );
  });
});

test('saveCompanyBilling does not mutate company billing state when audit insertion fails', async () => {
  await withDemoSupabase(async (supabase) => {
    await seedBillingCatalog(supabase);

    await assert.rejects(
      saveCompanyBilling(
        withAuditInsertError(supabase, new Error('audit insert failed')),
        'company-1',
        makeBillingPayload({ billing_status: 'cancelled' }),
        { id: 'superadmin-1' },
      ),
      /audit insert failed/,
    );

    const { data: companies } = await supabase
      .from('companies')
      .select('id,status,plan')
      .eq('id', 'company-1');
    const { data: profiles } = await supabase
      .from('company_billing_profiles')
      .select('*')
      .eq('company_id', 'company-1');
    const { data: featureRows } = await supabase
      .from('company_feature_entitlements')
      .select('*')
      .eq('company_id', 'company-1');
    const { data: addonRows } = await supabase
      .from('company_addon_entitlements')
      .select('*')
      .eq('company_id', 'company-1');
    const { data: auditRows } = await supabase
      .from('platform_pricing_audit_events')
      .select('*')
      .eq('company_id', 'company-1');

    assert.equal(companies[0].status, 'active');
    assert.equal(companies[0].plan, 'track');
    assert.equal(profiles.length, 0);
    assert.equal(featureRows.length, 0);
    assert.equal(addonRows.length, 0);
    assert.equal(auditRows.length, 0);
  });
});

test('superadmin billing API rejects tenant admins and lets superadmin save custom pricing', async () => {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL,
    JWT_SECRET: process.env.JWT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    PORTAL_JWT_SECRET: process.env.PORTAL_JWT_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-superadmin-billing-api-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.SUPERADMIN_EMAIL = 'owner@noderoute.test';
  process.env.JWT_SECRET = 'BillingSecret!123';
  process.env.SESSION_SECRET = 'BillingSession!123';
  process.env.PORTAL_JWT_SECRET = 'BillingPortal!123';
  process.env.SUPABASE_URL = 'https://example.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  clearBillingModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const superadminRouter = require('../routes/superadmin');

    await supabase.from('companies').insert({
      id: '00000000-0000-0000-0000-00000000b111',
      name: 'Blue Harbor',
      slug: 'blue-harbor',
      plan: 'track',
      status: 'trial',
    });
    await supabase.from('users').insert({
      id: 'sa-001',
      name: 'Owner',
      email: 'owner@noderoute.test',
      role: 'superadmin',
      status: 'active',
      company_id: '00000000-0000-0000-0000-00000000b111',
    });
    await supabase.from('users').insert({
      id: 'admin-002',
      name: 'Tenant Admin',
      email: 'admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: '00000000-0000-0000-0000-00000000b111',
    });
    await supabase.from('platform_plan_tiers').insert({ code: 'operations', name: 'Operations', display_order: 30, monthly_price_cents: 149900, setup_price_cents: 350000 });
    await supabase.from('platform_plan_tiers').insert({ code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 });
    await supabase.from('platform_addons').insert({ code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track', 'operations'], display_order: 10 });

    const app = express();
    app.use(express.json());
    app.use('/api/superadmin', superadminRouter);
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ userId: 'admin-002' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const superToken = jwt.sign({ userId: 'sa-001' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const denied = await fetch(`${baseUrl}/api/superadmin/billing/catalog`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(denied.status, 403);

    const saved = await fetch(`${baseUrl}/api/superadmin/companies/00000000-0000-0000-0000-00000000b111/billing`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${superToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_tier_code: 'operations',
        billing_status: 'active',
        billing_interval: 'monthly',
        custom_pricing_enabled: true,
        custom_monthly_price_cents: 180000,
        custom_setup_price_cents: 400000,
        annual_discount_bps: 0,
        contract_start_date: null,
        contract_end_date: null,
        pricing_notes: 'First customer custom price',
        feature_overrides: [],
        addons: [{
          addon_code: 'ai_phone_orders',
          enabled: true,
          quantity: 1,
          monthly_price_cents: 49900,
          setup_price_cents: null,
          usage_terms: '$0.20 per connected minute',
          notes: '',
        }],
      }),
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.profile.plan_tier_code, 'operations');
    assert.equal(body.profile.custom_monthly_price_cents, 180000);
    assert.equal(body.effectiveMonthlyCents, 229900);
    assert.equal(body.addons.find((addon) => addon.addon_code === 'ai_phone_orders').enabled, true);

    const audit = await supabase
      .from('platform_pricing_audit_events')
      .select('*')
      .eq('company_id', '00000000-0000-0000-0000-00000000b111');
    assert.equal(audit.error, null);
    assert.equal(audit.data.length, 1);
    assert.equal(audit.data[0].performed_by, 'sa-001');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    clearBillingModuleCache();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
