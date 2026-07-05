import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { companyBillingKey } from '../hooks/useSuperadminBilling';
import { renderWithQueryClient } from '../test/renderWithQueryClient';
import type { BillingCatalogResponse } from './superadmin/billing-types';
import { AddonChecklist } from './superadmin/AddonChecklist';
import { FeatureMatrixTable } from './superadmin/FeatureMatrixTable';

describe('Superadmin billing types', () => {
  it('supports workbook tier and add-on codes', () => {
    const catalog: BillingCatalogResponse = {
      tiers: [
        {
          code: 'track',
          name: 'Track',
          display_order: 10,
          monthly_price_cents: 29900,
          setup_price_cents: 75000,
          best_for: '',
          included_scope: '',
          excluded_gated: '',
          upgrade_trigger: '',
          sales_note: '',
        },
      ],
      features: [],
      featureMatrix: [],
      limits: [],
      addons: [
        {
          code: 'ai_phone_orders',
          name: 'AI Phone Orders',
          base_monthly_cents: 49900,
          default_setup_cents: null,
          usage_terms: '$0.20 per connected minute',
          eligible_tier_codes: ['track'],
          when_to_sell: '',
          pricing_rationale: '',
          quote_only: false,
          display_order: 10,
        },
      ],
    };

    expect(catalog.tiers[0].code).toBe('track');
    expect(catalog.addons[0].code).toBe('ai_phone_orders');
    expect(companyBillingKey('company-123')).toEqual(['superadmin-company-billing', 'company-123']);
  });
});

describe('AddonChecklist', () => {
  it('patches the add-on row when the checkbox changes', () => {
    const changes: unknown[] = [];

    renderWithQueryClient(
      <AddonChecklist
        addons={[
          {
            company_id: 'company-1',
            addon_code: 'ai_phone_orders',
            enabled: false,
            quantity: 1,
            monthly_price_cents: 49900,
            setup_price_cents: null,
            usage_terms: '$0.20 per connected minute',
            notes: '',
            addon: {
              code: 'ai_phone_orders',
              name: 'AI Phone Orders',
              base_monthly_cents: 49900,
              default_setup_cents: null,
              usage_terms: '$0.20 per connected minute',
              eligible_tier_codes: ['track'],
              when_to_sell: '',
              pricing_rationale: '',
              quote_only: false,
              display_order: 10,
            },
          },
        ]}
        onChange={(next) => changes.push(next)}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /AI Phone Orders/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual([
      expect.objectContaining({
        addon_code: 'ai_phone_orders',
        enabled: true,
        quantity: 1,
        monthly_price_cents: 49900,
      }),
    ]);
  });
});

describe('FeatureMatrixTable', () => {
  it('keeps non-add-on inclusions enabled when patched', () => {
    const changes: unknown[] = [];

    renderWithQueryClient(
      <FeatureMatrixTable
        catalog={{
          tiers: [
            {
              code: 'track',
              name: 'Track',
              display_order: 10,
              monthly_price_cents: 29900,
              setup_price_cents: 75000,
              best_for: '',
              included_scope: '',
              excluded_gated: '',
              upgrade_trigger: '',
              sales_note: '',
            },
          ],
          features: [
            {
              code: 'proof_of_delivery',
              name: 'Proof of Delivery',
              category: 'Operations',
              description: 'Collect signatures and photo evidence.',
              display_order: 10,
            },
          ],
          featureMatrix: [
            {
              tier_code: 'track',
              feature_code: 'proof_of_delivery',
              inclusion: 'yes',
              detail: '',
              pricing_scope_note: '',
            },
          ],
          limits: [],
          addons: [],
        }}
        editableFeatures={[
          {
            company_id: 'company-1',
            feature_code: 'proof_of_delivery',
            enabled: true,
            inclusion: 'yes',
            source: 'custom',
            notes: '',
          },
        ]}
        onChange={(next) => changes.push(next)}
      />,
    );

    const select = screen.getByRole('combobox', { name: /Proof of Delivery entitlement/i });
    fireEvent.change(select, { target: { value: 'limited' } });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual([
      expect.objectContaining({
        feature_code: 'proof_of_delivery',
        inclusion: 'limited',
        enabled: true,
      }),
    ]);
  });

  it.each(['add_on', 'discounted_add_on'] as const)('marks %s inclusions disabled', (inclusion) => {
    const changes: unknown[] = [];

    renderWithQueryClient(
      <FeatureMatrixTable
        catalog={{
          tiers: [
            {
              code: 'track',
              name: 'Track',
              display_order: 10,
              monthly_price_cents: 29900,
              setup_price_cents: 75000,
              best_for: '',
              included_scope: '',
              excluded_gated: '',
              upgrade_trigger: '',
              sales_note: '',
            },
          ],
          features: [
            {
              code: 'proof_of_delivery',
              name: 'Proof of Delivery',
              category: 'Operations',
              description: 'Collect signatures and photo evidence.',
              display_order: 10,
            },
          ],
          featureMatrix: [
            {
              tier_code: 'track',
              feature_code: 'proof_of_delivery',
              inclusion: 'yes',
              detail: '',
              pricing_scope_note: '',
            },
          ],
          limits: [],
          addons: [],
        }}
        editableFeatures={[
          {
            company_id: 'company-1',
            feature_code: 'proof_of_delivery',
            enabled: true,
            inclusion: 'yes',
            source: 'custom',
            notes: '',
          },
        ]}
        onChange={(next) => changes.push(next)}
      />,
    );

    const select = screen.getByRole('combobox', { name: /Proof of Delivery entitlement/i });
    fireEvent.change(select, { target: { value: inclusion } });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual([
      expect.objectContaining({
        feature_code: 'proof_of_delivery',
        inclusion,
        enabled: false,
      }),
    ]);
  });
});
