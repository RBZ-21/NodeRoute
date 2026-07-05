import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import type {
  BillingAnalyticsResponse,
  BillingCatalogResponse,
  CompanyBillingResponse,
  SaveCompanyBillingPayload,
} from '../pages/superadmin/billing-types';

export const billingCatalogKey = ['superadmin-billing-catalog'] as const;
export const billingAnalyticsKey = ['superadmin-billing-analytics'] as const;
export const companyBillingKey = (companyId: string | null) =>
  ['superadmin-company-billing', companyId] as const;

export function useBillingCatalog() {
  return useQuery({
    queryKey: billingCatalogKey,
    queryFn: () => fetchWithAuth<BillingCatalogResponse>('/api/superadmin/billing/catalog'),
  });
}

export function useBillingAnalytics() {
  return useQuery({
    queryKey: billingAnalyticsKey,
    queryFn: () => fetchWithAuth<BillingAnalyticsResponse>('/api/superadmin/billing/analytics'),
  });
}

export function useCompanyBilling(companyId: string | null) {
  return useQuery({
    queryKey: companyBillingKey(companyId),
    enabled: !!companyId,
    queryFn: () => fetchWithAuth<CompanyBillingResponse>(`/api/superadmin/companies/${companyId}/billing`),
  });
}

export function useSaveCompanyBilling(companyId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SaveCompanyBillingPayload) =>
      sendWithAuth<CompanyBillingResponse>(`/api/superadmin/companies/${companyId}/billing`, 'PATCH', payload),
    onSuccess: async () => {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: billingCatalogKey }),
        queryClient.invalidateQueries({ queryKey: billingAnalyticsKey }),
      ];

      if (companyId) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: companyBillingKey(companyId) }));
      }

      await Promise.all(invalidations);
    },
  });
}
