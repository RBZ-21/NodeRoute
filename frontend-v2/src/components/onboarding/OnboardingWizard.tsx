/**
 * OnboardingWizard — 4-step setup wizard shown to new companies before they
 * access the main application.
 *
 * Steps:
 *   1. Business Type   — multi-select vertical checkboxes
 *   2. Units of Measure — check which unit types apply
 *   3. Feature Preferences — toggle feature flags
 *   4. Inventory Starter — choose catalog setup method
 *
 * On completion it POSTs to /api/onboarding/complete and redirects to /dashboard.
 */
import { useState } from 'react';
import { sendWithAuth } from '../../lib/api';
import { invalidateCompanyConfigCache, BUSINESS_TYPE_LABELS, UNIT_LABELS } from '../../hooks/useCompanyConfig';
import type { BusinessType, UnitType, CatalogTemplate } from '../../hooks/useCompanyConfig';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardState = {
  businessTypes:           BusinessType[];
  enabledUnits:            UnitType[];
  featCatchWeight:         boolean;
  featFsmaLotTracking:     boolean;
  featColdChainNotes:      boolean;
  featAlcoholCompliance:   boolean;
  featDepositTracking:     boolean;
  featCaseToEach:          boolean;
  catalogTemplate:         CatalogTemplate;
  catalogSetup:            'template' | 'csv' | 'blank';
};

const INITIAL_STATE: WizardState = {
  businessTypes:           [],
  enabledUnits:            [],
  featCatchWeight:         false,
  featFsmaLotTracking:     false,
  featColdChainNotes:      false,
  featAlcoholCompliance:   false,
  featDepositTracking:     false,
  featCaseToEach:          false,
  catalogTemplate:         'blank',
  catalogSetup:            'blank',
};

const BUSINESS_TYPES: BusinessType[] = [
  'seafood', 'meat', 'produce', 'dairy',
  'liquor', 'paper', 'broadline', 'wholesale',
];

const UNIT_TYPES: { value: UnitType; description: string }[] = [
  { value: 'each',         description: 'Single countable items (bottles, rolls, bags)' },
  { value: 'case',         description: 'Boxes or cases with a fixed item count' },
  { value: 'lb',           description: 'Sold by weight at a fixed price per lb' },
  { value: 'catch_weight', description: 'Weight varies per unit (whole fish, meat cuts)' },
  { value: 'gallon',       description: 'Liquid volume (gallons, liters)' },
  { value: 'pallet',       description: 'Bulk pallet quantities' },
];

const FEATURE_FLAGS: {
  key: keyof Pick<WizardState,
    'featCatchWeight' | 'featFsmaLotTracking' | 'featColdChainNotes' |
    'featAlcoholCompliance' | 'featDepositTracking' | 'featCaseToEach'>;
  label: string;
  description: string;
}[] = [
  { key: 'featCatchWeight',       label: 'Catch Weight Capture',          description: 'Capture actual vs. estimated weight on variable-weight products.' },
  { key: 'featFsmaLotTracking',   label: 'FSMA 204 Lot Tracking',         description: 'Assign lot numbers to regulated food products for traceability.' },
  { key: 'featColdChainNotes',    label: 'Temperature / Cold Chain Notes', description: 'Record temperature or cold-chain notes on delivery stops.' },
  { key: 'featAlcoholCompliance', label: 'Alcohol Delivery Compliance',   description: '21+ confirmation and license number fields on alcohol orders.' },
  { key: 'featDepositTracking',   label: 'Deposit / Return Tracking',     description: 'Track deposit and return charges for kegs, crates, and pallets.' },
  { key: 'featCaseToEach',        label: 'Case-to-Each Breakdown',        description: 'Sell partial cases and break cases down to individual items.' },
];

const CATALOG_TEMPLATES: { value: CatalogTemplate; label: string; description: string }[] = [
  { value: 'seafood',    label: 'Seafood',                  description: 'Salmon, Halibut, Shrimp, Tuna, Lobster — catch-weight & lb units' },
  { value: 'liquor',     label: 'Liquor / Beer / Wine',     description: 'Cases, kegs, bottles with age-verification and deposit support' },
  { value: 'produce',    label: 'Produce',                  description: 'Roma Tomatoes, Romaine, Avocados — lb and case units' },
  { value: 'paper_goods',label: 'Paper & Janitorial Goods', description: 'Paper towels, trash bags, napkins — case and each units' },
  { value: 'broadline',  label: 'Broadline Food Service',   description: 'Mixed catalog across all categories — all unit types' },
  { value: 'blank',      label: 'Blank',                    description: 'Start with an empty catalog and add products manually' },
];

// ── Smart defaults — infer feature flags from business type selections ─────────
function autoSelectUnitsForTypes(types: BusinessType[]): UnitType[] {
  const units = new Set<UnitType>();
  if (types.includes('seafood'))   { units.add('lb'); units.add('catch_weight'); units.add('case'); }
  if (types.includes('meat'))      { units.add('lb'); units.add('catch_weight'); units.add('case'); }
  if (types.includes('produce'))   { units.add('lb'); units.add('case'); units.add('each'); }
  if (types.includes('dairy'))     { units.add('each'); units.add('case'); units.add('gallon'); }
  if (types.includes('liquor'))    { units.add('each'); units.add('case'); units.add('pallet'); }
  if (types.includes('paper'))     { units.add('each'); units.add('case'); }
  if (types.includes('broadline')) { UNIT_TYPES.forEach((u) => units.add(u.value)); }
  if (types.includes('wholesale')) { units.add('each'); units.add('case'); units.add('pallet'); }
  return [...units];
}

function autoSelectFlagsForTypes(types: BusinessType[]): Partial<WizardState> {
  return {
    featCatchWeight:       types.some((t) => ['seafood', 'meat'].includes(t)),
    featFsmaLotTracking:   types.some((t) => ['seafood', 'meat', 'produce', 'dairy', 'broadline'].includes(t)),
    featColdChainNotes:    types.some((t) => ['seafood', 'meat', 'produce', 'dairy', 'broadline'].includes(t)),
    featAlcoholCompliance: types.includes('liquor'),
    featDepositTracking:   types.includes('liquor'),
    featCaseToEach:        types.some((t) => ['broadline', 'paper', 'wholesale'].includes(t)),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const [step, setStep]       = useState(1);
  const [state, setState]     = useState<WizardState>(INITIAL_STATE);
  const [submitting, setSub]  = useState(false);
  const [error, setError]     = useState('');

  const totalSteps = 4;

  function toggle<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function toggleArray<T>(current: T[], value: T): T[] {
    return current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
  }

  function handleBusinessTypeToggle(type: BusinessType) {
    const next = toggleArray(state.businessTypes, type);
    setState((s) => ({
      ...s,
      businessTypes: next,
      // Auto-suggest units and feature flags, but don't override existing selections
      enabledUnits:  s.enabledUnits.length === 0 ? autoSelectUnitsForTypes(next) : s.enabledUnits,
      ...autoSelectFlagsForTypes(next),
    }));
  }

  async function handleSubmit() {
    if (state.businessTypes.length === 0) { setError('Select at least one business type.'); return; }
    if (state.enabledUnits.length === 0)  { setError('Select at least one unit type.'); return; }

    setSub(true);
    setError('');
    try {
      await sendWithAuth('/api/onboarding/complete', 'POST', {
        business_types:          state.businessTypes,
        enabled_units:           state.enabledUnits,
        feat_catch_weight:       state.featCatchWeight,
        feat_fsma_lot_tracking:  state.featFsmaLotTracking,
        feat_cold_chain_notes:   state.featColdChainNotes,
        feat_alcohol_compliance: state.featAlcoholCompliance,
        feat_deposit_tracking:   state.featDepositTracking,
        feat_case_to_each:       state.featCaseToEach,
        catalog_template:        state.catalogSetup === 'template' ? state.catalogTemplate : 'blank',
        catalog_setup:           state.catalogSetup,
      });
      invalidateCompanyConfigCache();
      window.location.href = '/dashboard';
    } catch (err) {
      setError(String((err as Error).message ?? 'Something went wrong. Please try again.'));
      setSub(false);
    }
  }

  return (
    <div className="min-h-screen bg-enterprise-gradient flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="text-sm font-bold uppercase tracking-widest text-primary">NodeRoute</div>
          <h1 className="text-2xl font-bold">Welcome — let's set up your account</h1>
          <p className="text-muted-foreground text-sm">
            Step {step} of {totalSteps} — takes about 2 minutes
          </p>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>

        {/* ── Step 1: Business Type ── */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>What best describes your business?</CardTitle>
              <CardDescription>Select all that apply — you can change this later.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BUSINESS_TYPES.map((type) => {
                const selected = state.businessTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleBusinessTypeToggle(type)}
                    className={`rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card hover:border-primary/50 hover:bg-muted/40'
                    }`}
                  >
                    {BUSINESS_TYPE_LABELS[type]}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Unit of Measure Preferences ── */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Which unit types apply to your products?</CardTitle>
              <CardDescription>Check all that apply. These will appear in order-entry dropdowns.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {UNIT_TYPES.map(({ value, description }) => {
                const checked = state.enabledUnits.includes(value);
                return (
                  <label key={value} className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle('enabledUnits', toggleArray(state.enabledUnits, value))}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <div>
                      <div className="font-medium text-sm">{UNIT_LABELS[value]}</div>
                      <div className="text-xs text-muted-foreground">{description}</div>
                    </div>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Feature Preferences ── */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Enable the features you need</CardTitle>
              <CardDescription>
                These control which fields appear across the app. You can adjust them in Settings at any time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {FEATURE_FLAGS.map(({ key, label, description }) => {
                const enabled = state[key] as boolean;
                return (
                  <div key={key} className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => toggle(key, !enabled as WizardState[typeof key])}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none ${
                        enabled ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                          enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* ── Step 4: Inventory Starter Template ── */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>How do you want to set up your product catalog?</CardTitle>
              <CardDescription>You can always add, edit, or import more products later.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Setup method */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    { value: 'template', label: 'Start from a template',      desc: 'Pre-loaded sample products for your vertical' },
                    { value: 'csv',      label: 'Import a CSV',                desc: 'Upload your own product list after setup' },
                    { value: 'blank',    label: 'Add manually',                desc: 'Start fresh and build your catalog yourself' },
                  ] as const
                ).map(({ value, label, desc }) => {
                  const selected = state.catalogSetup === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggle('catalogSetup', value)}
                      className={`rounded-lg border-2 px-4 py-3 text-left text-sm transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-card hover:border-primary/50'
                      }`}
                    >
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground mt-1">{desc}</div>
                    </button>
                  );
                })}
              </div>

              {/* Template picker (only when 'template' is selected) */}
              {state.catalogSetup === 'template' && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Choose a template:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {CATALOG_TEMPLATES.map(({ value, label, description }) => {
                      const selected = state.catalogTemplate === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggle('catalogTemplate', value)}
                          className={`rounded-lg border-2 px-3 py-2 text-left text-sm transition-colors ${
                            selected
                              ? 'border-primary bg-primary/10'
                              : 'border-border bg-card hover:border-primary/50'
                          }`}
                        >
                          <div className="font-medium">{label}</div>
                          <div className="text-xs text-muted-foreground">{description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {state.catalogSetup === 'csv' && (
                <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/40 p-3">
                  After your account is set up you'll find a CSV import option in{' '}
                  <strong>Inventory → Import</strong>. Your catalog will be empty to start.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </Button>

          {step < totalSteps ? (
            <Button
              onClick={() => {
                if (step === 1 && state.businessTypes.length === 0) {
                  setError('Please select at least one business type.');
                  return;
                }
                if (step === 2 && state.enabledUnits.length === 0) {
                  setError('Please select at least one unit type.');
                  return;
                }
                setError('');
                setStep((s) => s + 1);
              }}
            >
              Continue
            </Button>
          ) : (
            <Button disabled={submitting} onClick={handleSubmit}>
              {submitting ? 'Finishing setup…' : 'Finish Setup'}
            </Button>
          )}
        </div>

      </div>
    </div>
  );
}
