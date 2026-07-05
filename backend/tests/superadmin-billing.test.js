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
