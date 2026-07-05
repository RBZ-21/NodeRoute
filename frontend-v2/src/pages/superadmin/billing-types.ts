export type PlanTierCode = 'track' | 'dispatch' | 'operations' | 'erp' | 'enterprise';
export type BillingStatus = 'trial' | 'active' | 'paused' | 'cancelled';
export type BillingInterval = 'monthly' | 'annual';
export type FeatureInclusion =
  | 'no'
  | 'yes'
  | 'basic'
  | 'full'
  | 'limited'
  | 'add_on'
  | 'included_fair_use'
  | 'discounted_add_on'
  | 'custom'
  | 'assisted_migration';

export type PlanTier = {
  code: PlanTierCode;
  name: string;
  display_order: number;
  monthly_price_cents: number;
  setup_price_cents: number;
  best_for: string;
  included_scope: string;
  excluded_gated: string;
  upgrade_trigger: string;
  sales_note: string;
};

export type PlanFeature = {
  code: string;
  name: string;
  category: string;
  description: string;
  display_order: number;
};

export type PlanFeatureMatrixRow = {
  tier_code: PlanTierCode;
  feature_code: string;
  inclusion: FeatureInclusion;
  detail: string;
  pricing_scope_note: string;
};

export type PlanLimit = {
  tier_code: PlanTierCode;
  metric_code: string;
  metric_label: string;
  metric_value: string;
  numeric_value: number | null;
  unit: string;
  notes: string;
  display_order: number;
};

export type PlanAddon = {
  code: string;
  name: string;
  base_monthly_cents: number | null;
  default_setup_cents: number | null;
  usage_terms: string;
  eligible_tier_codes: PlanTierCode[];
  when_to_sell: string;
  pricing_rationale: string;
  quote_only: boolean;
  display_order: number;
};

export type BillingCatalogResponse = {
  tiers: PlanTier[];
  features: PlanFeature[];
  featureMatrix: PlanFeatureMatrixRow[];
  limits: PlanLimit[];
  addons: PlanAddon[];
};

export type CompanyBillingProfile = {
  company_id: string;
  plan_tier_code: PlanTierCode;
  billing_status: BillingStatus;
  billing_interval: BillingInterval;
  custom_pricing_enabled: boolean;
  custom_monthly_price_cents: number | null;
  custom_setup_price_cents: number | null;
  annual_discount_bps: number;
  contract_start_date: string | null;
  contract_end_date: string | null;
  pricing_notes: string;
};

export type CompanyFeatureEntitlement = {
  company_id: string;
  feature_code: string;
  enabled: boolean;
  inclusion: FeatureInclusion;
  source: 'tier' | 'addon' | 'custom';
  notes: string;
  feature?: PlanFeature;
};

export type CompanyAddonEntitlement = {
  company_id: string;
  addon_code: string;
  enabled: boolean;
  quantity: number;
  monthly_price_cents: number | null;
  setup_price_cents: number | null;
  usage_terms: string;
  notes: string;
  addon?: PlanAddon;
};

export type CompanyBillingResponse = {
  company: {
    id: string;
    name: string;
    slug: string | null;
    status: string;
    plan: string | null;
  };
  profile: CompanyBillingProfile;
  selectedTier: PlanTier;
  effectiveMonthlyCents: number;
  effectiveSetupCents: number;
  effectiveAnnualContractValueCents: number;
  catalog: BillingCatalogResponse;
  features: CompanyFeatureEntitlement[];
  addons: CompanyAddonEntitlement[];
  auditEvents: Array<{
    id: string;
    event_type: string;
    created_at: string;
    notes: string;
  }>;
};

export type BillingAnalyticsResponse = {
  total_companies: number;
  active_companies: number;
  mrr_cents: number;
  arr_cents: number;
  custom_pricing_companies: number;
  enabled_addons: number;
  tier_breakdown: Array<{
    tier: PlanTierCode;
    count: number;
    mrr_cents: number;
  }>;
};

export type SaveCompanyBillingPayload = {
  plan_tier_code: PlanTierCode;
  billing_status: BillingStatus;
  billing_interval: BillingInterval;
  custom_pricing_enabled: boolean;
  custom_monthly_price_cents: number | null;
  custom_setup_price_cents: number | null;
  annual_discount_bps: number;
  contract_start_date: string | null;
  contract_end_date: string | null;
  pricing_notes: string;
  feature_overrides: Array<{
    feature_code: string;
    enabled: boolean;
    inclusion: FeatureInclusion;
    notes: string;
  }>;
  addons: Array<{
    addon_code: string;
    enabled: boolean;
    quantity: number;
    monthly_price_cents: number | null;
    setup_price_cents: number | null;
    usage_terms: string;
    notes: string;
  }>;
};
