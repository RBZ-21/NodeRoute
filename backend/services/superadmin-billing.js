'use strict';

const { parseSaveCompanyBilling } = require('../lib/superadmin-billing-schemas');

const DEFAULT_SELECT_LIMIT = 10000;

function extractRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function normalizeMoneyCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function normalizeBillingPayload(input) {
  return parseSaveCompanyBilling(input);
}

function addonMonthlyCents(addon) {
  if (!addon?.enabled) return 0;
  const quantity = Number(addon.quantity ?? 1);
  const price = normalizeMoneyCents(addon.monthly_price_cents) ?? 0;
  return Math.round(quantity * price);
}

function addonSetupCents(addon) {
  if (!addon?.enabled) return 0;
  return normalizeMoneyCents(addon.setup_price_cents) ?? 0;
}

function calculateEffectiveMonthlyCents({ profile, tier, addons = [] }) {
  const base = profile?.custom_pricing_enabled
    ? normalizeMoneyCents(profile.custom_monthly_price_cents)
    : null;
  const tierBase = normalizeMoneyCents(tier?.monthly_price_cents) ?? 0;
  return (base ?? tierBase) + addons.reduce((sum, addon) => sum + addonMonthlyCents(addon), 0);
}

function calculateEffectiveSetupCents({ profile, tier, addons = [] }) {
  const base = profile?.custom_pricing_enabled
    ? normalizeMoneyCents(profile.custom_setup_price_cents)
    : null;
  const tierBase = normalizeMoneyCents(tier?.setup_price_cents) ?? 0;
  return (base ?? tierBase) + addons.reduce((sum, addon) => sum + addonSetupCents(addon), 0);
}

async function loadBillingCatalog(db) {
  const [tiers, features, featureMatrix, limits, addons] = await Promise.all([
    db.from('platform_plan_tiers').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_plan_features').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_plan_feature_matrix').select('*').limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_plan_limits').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_addons').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
  ]);

  for (const result of [tiers, features, featureMatrix, limits, addons]) {
    if (result.error) throw result.error;
  }

  return {
    tiers: extractRows(tiers),
    features: extractRows(features),
    featureMatrix: extractRows(featureMatrix),
    limits: extractRows(limits),
    addons: extractRows(addons),
  };
}

function defaultProfile(company, catalog) {
  const plan = String(company?.plan || '').toLowerCase();
  const tier = catalog.tiers.find((row) => row.code === plan)
    || catalog.tiers.find((row) => row.code === 'track')
    || catalog.tiers[0];
  return {
    company_id: company.id,
    plan_tier_code: tier.code,
    billing_status: company.status === 'suspended' ? 'paused' : (company.status || 'trial'),
    billing_interval: 'monthly',
    custom_pricing_enabled: false,
    custom_monthly_price_cents: null,
    custom_setup_price_cents: null,
    annual_discount_bps: 0,
    contract_start_date: null,
    contract_end_date: null,
    pricing_notes: '',
  };
}

function defaultFeatureEntitlements(companyId, profile, catalog) {
  const matrixRows = catalog.featureMatrix.filter((row) => row.tier_code === profile.plan_tier_code);
  return catalog.features.map((feature) => {
    const matrix = matrixRows.find((row) => row.feature_code === feature.code);
    const inclusion = matrix?.inclusion || 'no';
    return {
      company_id: companyId,
      feature_code: feature.code,
      enabled: !['no', 'add_on'].includes(inclusion),
      inclusion,
      source: 'tier',
      notes: '',
      feature,
    };
  });
}

function defaultAddonEntitlements(companyId, catalog) {
  return catalog.addons.map((addon) => ({
    company_id: companyId,
    addon_code: addon.code,
    enabled: false,
    quantity: 1,
    monthly_price_cents: addon.base_monthly_cents,
    setup_price_cents: addon.default_setup_cents,
    usage_terms: addon.usage_terms || '',
    notes: '',
    addon,
  }));
}

async function loadCompanyBilling(db, companyId) {
  const catalog = await loadBillingCatalog(db);
  const [companyResult, profileResult, featuresResult, addonsResult, auditResult] = await Promise.all([
    db.from('companies').select('id,name,slug,status,plan').eq('id', companyId).single(),
    db.from('company_billing_profiles').select('*').eq('company_id', companyId).single(),
    db.from('company_feature_entitlements').select('*').eq('company_id', companyId).limit(DEFAULT_SELECT_LIMIT),
    db.from('company_addon_entitlements').select('*').eq('company_id', companyId).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_pricing_audit_events').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(25),
  ]);

  if (companyResult.error) throw companyResult.error;
  if (featuresResult.error) throw featuresResult.error;
  if (addonsResult.error) throw addonsResult.error;
  if (auditResult.error) throw auditResult.error;
  if (profileResult.error && profileResult.error.code !== 'PGRST116') throw profileResult.error;

  const company = companyResult.data;
  const profile = profileResult.data || defaultProfile(company, catalog);
  const selectedTier = catalog.tiers.find((tier) => tier.code === profile.plan_tier_code) || catalog.tiers[0];
  const savedFeatures = extractRows(featuresResult);
  const savedAddons = extractRows(addonsResult);
  const features = defaultFeatureEntitlements(companyId, profile, catalog).map((row) => ({
    ...row,
    ...(savedFeatures.find((saved) => saved.feature_code === row.feature_code) || {}),
    feature: row.feature,
  }));
  const addons = defaultAddonEntitlements(companyId, catalog).map((row) => ({
    ...row,
    ...(savedAddons.find((saved) => saved.addon_code === row.addon_code) || {}),
    addon: row.addon,
  }));

  const effectiveMonthlyCents = calculateEffectiveMonthlyCents({ profile, tier: selectedTier, addons });
  const effectiveSetupCents = calculateEffectiveSetupCents({ profile, tier: selectedTier, addons });

  return {
    catalog,
    company,
    profile,
    selectedTier,
    effectiveMonthlyCents,
    effectiveSetupCents,
    effectiveAnnualContractValueCents: effectiveMonthlyCents * 12 + effectiveSetupCents,
    features,
    addons,
    auditEvents: extractRows(auditResult),
  };
}

async function upsertRows(db, table, rows) {
  if (!rows.length) return [];
  const { data, error } = await db.from(table).upsert(rows).select();
  if (error) throw error;
  return data || [];
}

async function saveCompanyBilling(db, companyId, input, actor) {
  const payload = normalizeBillingPayload(input);
  const before = await loadCompanyBilling(db, companyId).catch(() => null);
  const now = new Date().toISOString();

  const profile = {
    company_id: companyId,
    plan_tier_code: payload.plan_tier_code,
    billing_status: payload.billing_status,
    billing_interval: payload.billing_interval,
    custom_pricing_enabled: payload.custom_pricing_enabled,
    custom_monthly_price_cents: payload.custom_monthly_price_cents,
    custom_setup_price_cents: payload.custom_setup_price_cents,
    annual_discount_bps: payload.annual_discount_bps,
    contract_start_date: payload.contract_start_date,
    contract_end_date: payload.contract_end_date,
    pricing_notes: payload.pricing_notes,
    updated_by: actor?.id || null,
    updated_at: now,
  };

  const { error: companyErr } = await db.from('companies').update({
    plan: payload.plan_tier_code,
    status: payload.billing_status === 'paused' ? 'suspended' : payload.billing_status,
  }).eq('id', companyId);
  if (companyErr) throw companyErr;

  await upsertRows(db, 'company_billing_profiles', [profile]);
  await upsertRows(db, 'company_feature_entitlements', payload.feature_overrides.map((feature) => ({
    company_id: companyId,
    feature_code: feature.feature_code,
    enabled: feature.enabled,
    inclusion: feature.inclusion,
    source: 'custom',
    notes: feature.notes,
    updated_by: actor?.id || null,
    updated_at: now,
  })));
  await upsertRows(db, 'company_addon_entitlements', payload.addons.map((addon) => ({
    company_id: companyId,
    addon_code: addon.addon_code,
    enabled: addon.enabled,
    quantity: addon.quantity,
    monthly_price_cents: addon.monthly_price_cents,
    setup_price_cents: addon.setup_price_cents,
    usage_terms: addon.usage_terms,
    notes: addon.notes,
    updated_by: actor?.id || null,
    updated_at: now,
  })));

  await db.from('platform_pricing_audit_events').insert({
    company_id: companyId,
    event_type: before?.profile?.plan_tier_code === payload.plan_tier_code ? 'pricing_changed' : 'tier_changed',
    performed_by: actor?.id || null,
    previous_value: before ? {
      profile: before.profile,
      addons: before.addons.map((addon) => ({ addon_code: addon.addon_code, enabled: addon.enabled, monthly_price_cents: addon.monthly_price_cents })),
    } : {},
    next_value: payload,
    notes: payload.pricing_notes || '',
  });

  return loadCompanyBilling(db, companyId);
}

async function billingAnalytics(db) {
  const [companiesResult, profilesResult, addonsResult, catalog] = await Promise.all([
    db.from('companies').select('id,name,status,plan').limit(DEFAULT_SELECT_LIMIT),
    db.from('company_billing_profiles').select('*').limit(DEFAULT_SELECT_LIMIT),
    db.from('company_addon_entitlements').select('*').eq('enabled', true).limit(DEFAULT_SELECT_LIMIT),
    loadBillingCatalog(db),
  ]);
  if (companiesResult.error) throw companiesResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (addonsResult.error) throw addonsResult.error;

  const companies = extractRows(companiesResult);
  const profiles = extractRows(profilesResult);
  const addons = extractRows(addonsResult);
  const tierMap = new Map(catalog.tiers.map((tier) => [tier.code, tier]));

  let mrrCents = 0;
  const tierBreakdown = new Map();
  for (const company of companies) {
    const profile = profiles.find((row) => String(row.company_id) === String(company.id)) || defaultProfile(company, catalog);
    const tier = tierMap.get(profile.plan_tier_code) || catalog.tiers[0];
    const companyAddons = addons.filter((row) => String(row.company_id) === String(company.id));
    const monthly = calculateEffectiveMonthlyCents({ profile, tier, addons: companyAddons });
    mrrCents += profile.billing_status === 'active' ? monthly : 0;
    const current = tierBreakdown.get(profile.plan_tier_code) || { tier: profile.plan_tier_code, count: 0, mrr_cents: 0 };
    current.count += 1;
    if (profile.billing_status === 'active') current.mrr_cents += monthly;
    tierBreakdown.set(profile.plan_tier_code, current);
  }

  return {
    total_companies: companies.length,
    active_companies: companies.filter((company) => company.status === 'active').length,
    mrr_cents: mrrCents,
    arr_cents: mrrCents * 12,
    custom_pricing_companies: profiles.filter((profile) => profile.custom_pricing_enabled).length,
    enabled_addons: addons.length,
    tier_breakdown: Array.from(tierBreakdown.values()).sort((a, b) => String(a.tier).localeCompare(String(b.tier))),
  };
}

module.exports = {
  billingAnalytics,
  calculateEffectiveMonthlyCents,
  calculateEffectiveSetupCents,
  loadBillingCatalog,
  loadCompanyBilling,
  normalizeBillingPayload,
  saveCompanyBilling,
};
