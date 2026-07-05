'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateEffectiveMonthlyCents,
  calculateEffectiveSetupCents,
  normalizeBillingPayload,
  saveCompanyBilling,
} = require('../services/superadmin-billing');

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

test('superadmin billing save works against the demo Supabase client without native upsert', async () => {
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

    await supabase.from('companies').insert({
      id: 'company-1',
      name: 'Acme Seafood',
      slug: 'acme-seafood',
      status: 'active',
      plan: 'track',
    });
    await supabase.from('platform_plan_tiers').insert([
      { code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 },
      { code: 'erp', name: 'ERP', display_order: 20, monthly_price_cents: 249900, setup_price_cents: 750000 },
    ]);
    await supabase.from('platform_plan_features').insert([
      { code: 'driver_pwa', name: 'Driver PWA', category: 'delivery', description: '', display_order: 10 },
    ]);
    await supabase.from('platform_plan_feature_matrix').insert([
      { tier_code: 'track', feature_code: 'driver_pwa', inclusion: 'yes' },
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

    const result = await saveCompanyBilling(supabase, 'company-1', {
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
    }, { id: 'superadmin-1' });

    assert.equal(result.profile.plan_tier_code, 'erp');
    assert.equal(result.profile.custom_pricing_enabled, true);
    assert.equal(result.effectiveMonthlyCents, 307800);
    assert.equal(result.company.plan, 'erp');
    assert.equal(result.features[0].source, 'custom');
    assert.equal(result.addons[0].enabled, true);
    assert.equal(result.auditEvents.length, 1);
  } finally {
    clearSupabaseTestCache();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
