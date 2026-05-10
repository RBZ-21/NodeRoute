/**
 * useCompanyConfig — exposes the current company's feature flags and vertical
 * configuration to any component in the app.
 *
 * Data is fetched once on mount and cached; components can call this hook freely
 * without triggering additional network requests.
 *
 * Usage:
 *   const { features, enabledUnits, businessTypes, isLoading } = useCompanyConfig();
 *   if (features.catchWeight) { ... }
 */
import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../lib/api';

export type BusinessType =
  | 'seafood' | 'meat' | 'produce' | 'dairy'
  | 'liquor' | 'paper' | 'broadline' | 'wholesale';

export type UnitType = 'each' | 'case' | 'lb' | 'catch_weight' | 'gallon' | 'pallet';

export type CatalogTemplate =
  | 'seafood' | 'liquor' | 'produce' | 'paper_goods' | 'broadline' | 'blank';

export type CompanyFeatures = {
  catchWeight:      boolean;  // catch-weight (actual vs estimated weight) workflow
  fsmaLotTracking:  boolean;  // FSMA 204 lot number assignment on regulated products
  coldChainNotes:   boolean;  // temperature / cold-chain notes on delivery stops
  alcoholCompliance:boolean;  // 21+ confirmation + license fields on alcohol orders
  depositTracking:  boolean;  // deposit/return tracking for kegs, crates, pallets
  caseToEach:       boolean;  // partial-case (case-to-each) breakdown in orders
};

export type CompanyConfig = {
  businessTypes:       BusinessType[];
  enabledUnits:        UnitType[];
  features:            CompanyFeatures;
  catalogTemplate:     CatalogTemplate;
  onboardingCompleted: boolean;
};

const DEFAULT_CONFIG: CompanyConfig = {
  businessTypes:       [],
  enabledUnits:        [],
  features: {
    catchWeight:      false,
    fsmaLotTracking:  false,
    coldChainNotes:   false,
    alcoholCompliance:false,
    depositTracking:  false,
    caseToEach:       false,
  },
  catalogTemplate:     'blank',
  onboardingCompleted: false,
};

// Module-level cache so the fetch runs once per page load, not once per hook mount.
let _cache: CompanyConfig | null = null;
let _inflight: Promise<CompanyConfig> | null = null;

async function fetchConfig(): Promise<CompanyConfig> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;

  _inflight = fetchWithAuth<{
    business_types:         string[];
    enabled_units:          string[];
    feat_catch_weight:      boolean;
    feat_fsma_lot_tracking: boolean;
    feat_cold_chain_notes:  boolean;
    feat_alcohol_compliance:boolean;
    feat_deposit_tracking:  boolean;
    feat_case_to_each:      boolean;
    catalog_template:       string;
    onboarding_completed:   boolean;
  }>('/api/company-config/features').then((raw) => {
    const cfg: CompanyConfig = {
      businessTypes:   (raw.business_types ?? []) as BusinessType[],
      enabledUnits:    (raw.enabled_units  ?? []) as UnitType[],
      features: {
        catchWeight:      raw.feat_catch_weight      ?? false,
        fsmaLotTracking:  raw.feat_fsma_lot_tracking ?? false,
        coldChainNotes:   raw.feat_cold_chain_notes  ?? false,
        alcoholCompliance:raw.feat_alcohol_compliance ?? false,
        depositTracking:  raw.feat_deposit_tracking  ?? false,
        caseToEach:       raw.feat_case_to_each       ?? false,
      },
      catalogTemplate:     (raw.catalog_template  ?? 'blank') as CatalogTemplate,
      onboardingCompleted: raw.onboarding_completed ?? false,
    };
    _cache = cfg;
    _inflight = null;
    return cfg;
  }).catch(() => {
    _inflight = null;
    return DEFAULT_CONFIG;
  });

  return _inflight;
}

/** Call this after a successful onboarding completion to invalidate the cache. */
export function invalidateCompanyConfigCache() {
  _cache = null;
  _inflight = null;
}

type ConfigState = CompanyConfig & {
  config:    CompanyConfig;
  isLoading: boolean;
  error:     string | null;
  reload:    () => void;
};

export function useCompanyConfig(): ConfigState {
  const [config, setConfig]     = useState<CompanyConfig>(_cache ?? DEFAULT_CONFIG);
  const [isLoading, setLoading] = useState<boolean>(!_cache);
  const [error, setError]       = useState<string | null>(null);
  const [rev, setRev]           = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchConfig()
      .then((cfg) => { if (!cancelled) { setConfig(cfg); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(String(err?.message ?? err)); setLoading(false); } });

    return () => { cancelled = true; };
  }, [rev]);

  return {
    config,
    isLoading,
    error,
    reload:        () => { invalidateCompanyConfigCache(); setRev((r) => r + 1); },
    // Top-level convenience accessors matching CompanyConfig shape:
    businessTypes: config.businessTypes,
    enabledUnits:  config.enabledUnits,
    features:      config.features,
    catalogTemplate:     config.catalogTemplate,
    onboardingCompleted: config.onboardingCompleted,
  };
}


/** Human-readable labels for unit types shown in dropdowns. */
export const UNIT_LABELS: Record<UnitType, string> = {
  each:         'Each',
  case:         'Case',
  lb:           'Pound (lb)',
  catch_weight: 'Catch Weight',
  gallon:       'Gallon / Liter',
  pallet:       'Pallet',
};

/** Human-readable labels for business types. */
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  seafood:   'Seafood / Fresh Fish',
  meat:      'Meat & Poultry',
  produce:   'Produce',
  dairy:     'Dairy & Frozen',
  liquor:    'Liquor / Beer / Wine',
  paper:     'Paper & Janitorial Goods',
  broadline: 'Broadline Food Service',
  wholesale: 'General Wholesale / Other',
};
