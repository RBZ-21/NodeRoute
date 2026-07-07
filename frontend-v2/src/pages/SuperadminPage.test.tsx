import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { companyBillingKey } from '../hooks/useSuperadminBilling';
import { renderWithQueryClient } from '../test/renderWithQueryClient';
import { BillingDashboardPanel } from './superadmin/BillingDashboardPanel';
import type { BillingCatalogResponse } from './superadmin/billing-types';
import { AddonChecklist } from './superadmin/AddonChecklist';
import { ClientBillingDrawer } from './superadmin/ClientBillingDrawer';
import { FeatureMatrixTable } from './superadmin/FeatureMatrixTable';

const { useBillingCatalogMock, useBillingAnalyticsMock, useCompanyBillingMock, useSaveCompanyBillingMock } = vi.hoisted(() => ({
  useBillingCatalogMock: vi.fn(),
  useBillingAnalyticsMock: vi.fn(),
  useCompanyBillingMock: vi.fn(),
  useSaveCompanyBillingMock: vi.fn(),
}));

vi.mock('../hooks/useSuperadminBilling', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../hooks/useSuperadminBilling');
  return {
    ...actual,
    useBillingCatalog: useBillingCatalogMock,
    useBillingAnalytics: useBillingAnalyticsMock,
    useCompanyBilling: useCompanyBillingMock,
    useSaveCompanyBilling: useSaveCompanyBillingMock,
  };
});

beforeEach(() => {
  useBillingCatalogMock.mockReset();
  useBillingAnalyticsMock.mockReset();
  useCompanyBillingMock.mockReset();
  useSaveCompanyBillingMock.mockReset();
});

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

describe('BillingDashboardPanel', () => {
  it('renders workbook-backed tier names and analytics MRR', async () => {
    useBillingCatalogMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
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
          {
            code: 'operations',
            name: 'Operations',
            display_order: 20,
            monthly_price_cents: 149900,
            setup_price_cents: 100000,
            best_for: '',
            included_scope: '',
            excluded_gated: '',
            upgrade_trigger: '',
            sales_note: '',
          },
        ],
        features: [
          {
            code: 'route_optimization',
            name: 'Route Optimization',
            category: 'Operations',
            description: 'Plan delivery runs from order demand.',
            display_order: 10,
          },
        ],
        featureMatrix: [
          {
            tier_code: 'operations',
            feature_code: 'route_optimization',
            inclusion: 'full',
            detail: '',
            pricing_scope_note: '',
          },
        ],
        limits: [],
        addons: [],
      },
    });
    useBillingAnalyticsMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        total_companies: 3,
        active_companies: 2,
        mrr_cents: 149900,
        arr_cents: 1798800,
        custom_pricing_companies: 1,
        enabled_addons: 4,
        tier_breakdown: [{ tier: 'operations', count: 1, mrr_cents: 149900 }],
      },
    });

    renderWithQueryClient(<BillingDashboardPanel />);

    expect(await screen.findByText('Billing MRR')).toBeInTheDocument();
    expect(screen.getByText('$1,499')).toBeInTheDocument();
    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0);
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

describe('ClientBillingDrawer', () => {
  it('lets superadmin set tier, custom pricing, and add-on checkboxes', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useSaveCompanyBillingMock.mockReturnValue({ mutateAsync, isPending: false });
    useCompanyBillingMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        catalog: {
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
            {
              code: 'operations',
              name: 'Operations',
              display_order: 20,
              monthly_price_cents: 79900,
              setup_price_cents: 100000,
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
          addons: [],
        },
        company: { id: 'company-1', name: 'Blue Harbor', slug: 'blue-harbor', status: 'trial', plan: 'track' },
        profile: {
          company_id: 'company-1',
          plan_tier_code: 'track',
          billing_status: 'trial',
          billing_interval: 'monthly',
          custom_pricing_enabled: false,
          custom_monthly_price_cents: null,
          custom_setup_price_cents: null,
          annual_discount_bps: 0,
          contract_start_date: null,
          contract_end_date: null,
          pricing_notes: '',
        },
        selectedTier: { code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 },
        effectiveMonthlyCents: 29900,
        effectiveSetupCents: 75000,
        effectiveAnnualContractValueCents: 433800,
        features: [],
        addons: [
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
        ],
        auditEvents: [],
      },
    });

    renderWithQueryClient(<ClientBillingDrawer companyId="company-1" open onClose={() => {}} onSaved={() => {}} />);

    fireEvent.change(await screen.findByLabelText('Plan tier'), { target: { value: 'operations' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Custom pricing' }));
    fireEvent.change(screen.getByLabelText('Custom monthly price'), { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /AI Phone Orders/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Billing' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_tier_code: 'operations',
          custom_pricing_enabled: true,
          custom_monthly_price_cents: 180000,
          addons: [
            expect.objectContaining({
              addon_code: 'ai_phone_orders',
              enabled: true,
            }),
          ],
        }),
      ),
    );
  });
});
