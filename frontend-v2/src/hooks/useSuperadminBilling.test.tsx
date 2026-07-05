import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BillingAnalyticsResponse,
  BillingCatalogResponse,
  CompanyBillingResponse,
  SaveCompanyBillingPayload,
} from '../pages/superadmin/billing-types';
import { createTestQueryClient } from '../test/renderWithQueryClient';
import {
  billingAnalyticsKey,
  billingCatalogKey,
  companyBillingKey,
  useBillingAnalytics,
  useBillingCatalog,
  useCompanyBilling,
  useSaveCompanyBilling,
} from './useSuperadminBilling';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

const catalogResponse: BillingCatalogResponse = {
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
  addons: [],
};

const analyticsResponse: BillingAnalyticsResponse = {
  total_companies: 10,
  active_companies: 8,
  mrr_cents: 199900,
  arr_cents: 2398800,
  custom_pricing_companies: 2,
  enabled_addons: 4,
  tier_breakdown: [{ tier: 'track', count: 5, mrr_cents: 149500 }],
};

const companyBillingResponse: CompanyBillingResponse = {
  company: {
    id: 'company-1',
    name: 'Acme Seafood',
    slug: 'acme-seafood',
    status: 'active',
    plan: 'track',
  },
  profile: {
    company_id: 'company-1',
    plan_tier_code: 'track',
    billing_status: 'active',
    billing_interval: 'monthly',
    custom_pricing_enabled: false,
    custom_monthly_price_cents: null,
    custom_setup_price_cents: null,
    annual_discount_bps: 0,
    contract_start_date: null,
    contract_end_date: null,
    pricing_notes: '',
  },
  selectedTier: catalogResponse.tiers[0],
  effectiveMonthlyCents: 29900,
  effectiveSetupCents: 75000,
  effectiveAnnualContractValueCents: 433800,
  features: [],
  addons: [],
  auditEvents: [],
};

const savePayload: SaveCompanyBillingPayload = {
  plan_tier_code: 'track',
  billing_status: 'active',
  billing_interval: 'monthly',
  custom_pricing_enabled: false,
  custom_monthly_price_cents: null,
  custom_setup_price_cents: null,
  annual_discount_bps: 0,
  contract_start_date: null,
  contract_end_date: null,
  pricing_notes: '',
  feature_overrides: [],
  addons: [],
};

function createWrapper() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

describe('useSuperadminBilling', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the billing catalog through fetchWithAuth', async () => {
    fetchWithAuthMock.mockResolvedValueOnce(catalogResponse);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useBillingCatalog(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/superadmin/billing/catalog');
    expect(result.current.data).toEqual(catalogResponse);
  });

  it('loads billing analytics through fetchWithAuth', async () => {
    fetchWithAuthMock.mockResolvedValueOnce(analyticsResponse);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useBillingAnalytics(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/superadmin/billing/analytics');
    expect(result.current.data).toEqual(analyticsResponse);
  });

  it('loads a company billing profile through fetchWithAuth', async () => {
    fetchWithAuthMock.mockResolvedValueOnce(companyBillingResponse);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useCompanyBilling('company-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/superadmin/companies/company-1/billing');
    expect(result.current.data).toEqual(companyBillingResponse);
  });

  it('does not fetch company billing when no company is selected', async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useCompanyBilling(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

    expect(result.current.status).toBe('pending');
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
  });

  it('saves company billing through sendWithAuth and invalidates owned billing queries', async () => {
    sendWithAuthMock.mockResolvedValueOnce(companyBillingResponse);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue();

    const { result } = renderHook(() => useSaveCompanyBilling('company-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(savePayload);
    });

    expect(sendWithAuthMock).toHaveBeenCalledWith(
      '/api/superadmin/companies/company-1/billing',
      'PATCH',
      savePayload,
    );
    expect(invalidateSpy.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: billingCatalogKey },
      { queryKey: billingAnalyticsKey },
      { queryKey: companyBillingKey('company-1') },
    ]);
  });
});
