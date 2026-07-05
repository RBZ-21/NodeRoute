import { describe, expect, it, vi } from 'vitest';
import type { BillingCatalogResponse } from './superadmin/billing-types';

describe('Superadmin billing types', () => {
  it('supports workbook tier and add-on codes', () => {
    const catalog: BillingCatalogResponse = {
      tiers: [{ code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 }],
      features: [],
      featureMatrix: [],
      limits: [],
      addons: [{ code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, default_setup_cents: null, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track'], quote_only: false, display_order: 10 }],
    };
    expect(catalog.tiers[0].code).toBe('track');
    expect(catalog.addons[0].code).toBe('ai_phone_orders');
  });
});

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient } from '../test/renderWithQueryClient';
import { AddonChecklist } from './superadmin/AddonChecklist';

describe('AddonChecklist', () => {
  it('renders add-ons as list-style checkboxes and emits checked changes', () => {
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
  });
});

import { ClientBillingDrawer } from './superadmin/ClientBillingDrawer';

const { useCompanyBillingMock, useSaveCompanyBillingMock } = vi.hoisted(() => ({
  useCompanyBillingMock: vi.fn(),
  useSaveCompanyBillingMock: vi.fn(),
}));

vi.mock('../hooks/useSuperadminBilling', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../hooks/useSuperadminBilling');
  return {
    ...actual,
    useCompanyBilling: useCompanyBillingMock,
    useSaveCompanyBilling: useSaveCompanyBillingMock,
  };
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
            { code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 },
            { code: 'operations', name: 'Operations', display_order: 30, monthly_price_cents: 149900, setup_price_cents: 350000 },
          ],
          features: [],
          featureMatrix: [],
          limits: [],
          addons: [{ code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, default_setup_cents: null, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track'], quote_only: false, display_order: 10 }],
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
        addons: [{
          company_id: 'company-1',
          addon_code: 'ai_phone_orders',
          enabled: false,
          quantity: 1,
          monthly_price_cents: 49900,
          setup_price_cents: null,
          usage_terms: '$0.20 per connected minute',
          notes: '',
          addon: { code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, default_setup_cents: null, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track'], quote_only: false, display_order: 10 },
        }],
        auditEvents: [],
      },
    });

    renderWithQueryClient(<ClientBillingDrawer companyId="company-1" open onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Plan tier'), { target: { value: 'operations' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Custom pricing' }));
    fireEvent.change(screen.getByLabelText('Custom monthly price'), { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /AI Phone Orders/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Billing' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });
});
