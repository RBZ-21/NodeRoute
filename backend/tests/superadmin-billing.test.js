'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateEffectiveMonthlyCents,
  calculateEffectiveSetupCents,
  normalizeBillingPayload,
} = require('../services/superadmin-billing');

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

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBillingModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}superadmin.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}superadmin-billing.js`)
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

test('superadmin billing API rejects tenant admins and lets superadmin save custom pricing', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const previousSuperadminEmail = process.env.SUPERADMIN_EMAIL;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-superadmin-billing-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.SUPERADMIN_EMAIL = 'owner@noderoute.test';
  clearBillingModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const superadminRouter = require('../routes/superadmin');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('companies').insert({ id: '00000000-0000-0000-0000-00000000b111', name: 'Blue Harbor', slug: 'blue-harbor', plan: 'track', status: 'trial' });
    await supabase.from('users').insert({ id: 'sa-001', name: 'Owner', email: 'owner@noderoute.test', role: 'superadmin', status: 'active', company_id: '00000000-0000-0000-0000-00000000b111' });
    await supabase.from('users').insert({ id: 'admin-002', name: 'Tenant Admin', email: 'admin@noderoute.test', role: 'admin', status: 'active', company_id: '00000000-0000-0000-0000-00000000b111' });
    await supabase.from('platform_plan_tiers').insert({ code: 'operations', name: 'Operations', display_order: 30, monthly_price_cents: 149900, setup_price_cents: 350000 });
    await supabase.from('platform_plan_tiers').insert({ code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 });
    await supabase.from('platform_addons').insert({ code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track','operations'], display_order: 10 });

    const app = express();
    app.use(express.json());
    app.use('/api/superadmin', superadminRouter);
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ userId: 'admin-002' }, jwtSecret, { expiresIn: '1h' });
    const superToken = jwt.sign({ userId: 'sa-001' }, jwtSecret, { expiresIn: '1h' });

    const denied = await fetch(`${baseUrl}/api/superadmin/billing/catalog`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(denied.status, 403);

    const saved = await fetch(`${baseUrl}/api/superadmin/companies/00000000-0000-0000-0000-00000000b111/billing`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json' },
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
        addons: [{ addon_code: 'ai_phone_orders', enabled: true, quantity: 1, monthly_price_cents: 49900, setup_price_cents: null, usage_terms: '$0.20 per connected minute', notes: '' }],
      }),
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.profile.plan_tier_code, 'operations');
    assert.equal(body.profile.custom_monthly_price_cents, 180000);
    assert.equal(body.effectiveMonthlyCents, 229900);
    assert.equal(body.addons.find((addon) => addon.addon_code === 'ai_phone_orders').enabled, true);
    const audit = await supabase.from('platform_pricing_audit_events').select('*').eq('company_id', '00000000-0000-0000-0000-00000000b111');
    assert.equal(audit.error, null);
    assert.equal(audit.data.length, 1);
    assert.equal(audit.data[0].performed_by, 'sa-001');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    if (previousSuperadminEmail === undefined) delete process.env.SUPERADMIN_EMAIL;
    else process.env.SUPERADMIN_EMAIL = previousSuperadminEmail;
    clearBillingModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});

test('workbook plan limits expose drivers and monthly stops by tier', async () => {
  const { planLimitsFor } = require('../services/plan-limits');
  assert.deepEqual(planLimitsFor({ plan: 'track' }), {
    plan: 'track',
    maxDrivers: 2,
    maxDeliveriesPerMonth: 500,
  });
  assert.deepEqual(planLimitsFor({ plan: 'operations' }), {
    plan: 'operations',
    maxDrivers: 10,
    maxDeliveriesPerMonth: 5000,
  });
});
