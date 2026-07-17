import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCurrentUser, fetchWithAuth, sendWithAuth } from '../lib/api';

export type CurrentUser = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  companyName?: string;
  locationName?: string;
};

export type CutoffOption = { label: string; value: number | string };

export type CompanySettings = {
  forceDriverSignature?: boolean;
  forceDriverProofOfDelivery?: boolean;
  businessName?: string;
  invoiceLogoDataUrl?: string | null;
  invoiceAddress?: string;
  invoicePhone?: string;
  invoiceFax?: string;
  invoiceAfterHoursPhone?: string;
  invoiceRemitTo?: string;
  invoiceSalesTerms?: string;
  invoiceCreditTerms?: string;
  invoiceCopyLabel?: string;
  invoiceSafetyNotice?: string;
  orderCutoffHour?: number;
  orderCutoffDay?: string;
  cutoffHourOptions?: CutoffOption[];
  cutoffDayOptions?: CutoffOption[];
};

export type BillingCompany = {
  id?: string;
  name?: string;
  plan?: string | null;
  status?: string | null;
};

export type BillingProfile = {
  plan_tier_code?: string | null;
  billing_status?: string | null;
  billing_interval?: string | null;
  custom_pricing_enabled?: boolean;
  custom_monthly_price_cents?: number | null;
  custom_setup_price_cents?: number | null;
};

export type BillingConfig = {
  enabled?: boolean;
  provider?: string;
  mode?: 'test' | 'live' | 'missing' | 'unknown' | string;
  test_mode?: boolean;
  checkout_preview?: boolean;
  live_mode_blocked?: boolean;
  readiness_code?: string;
  message?: string;
  can_manage_billing?: boolean;
  product_name?: string;
  price_label?: string;
  support_email?: string;
  company?: BillingCompany | null;
  billing_profile?: BillingProfile | null;
  effective_monthly_cents?: number | null;
  effective_setup_cents?: number | null;
  custom_pricing_enabled?: boolean;
};

export type BillingCheckoutResponse = {
  checkout_url?: string;
  provider?: string;
  session_id?: string;
  mode?: string;
  test_mode?: boolean;
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: () => fetchCurrentUser<CurrentUser>(),
    staleTime: 30_000,
  });
}

export function useCompanySettings() {
  return useQuery({
    queryKey: ['company-settings'],
    queryFn: () => fetchWithAuth<CompanySettings>('/api/settings/company'),
    staleTime: 30_000,
  });
}

export function useBillingConfig() {
  return useQuery({
    queryKey: ['billing-config'],
    queryFn: () => fetchWithAuth<BillingConfig>('/api/billing/config'),
    staleTime: 30_000,
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, name }: { userId: string; name: string }) =>
      sendWithAuth(`/api/users/${userId}`, 'PATCH', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['current-user'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      sendWithAuth<{ message?: string }>('/auth/change-password', 'POST', { currentPassword, newPassword }),
  });
}

export function useSaveCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CompanySettings) =>
      sendWithAuth<CompanySettings>('/api/settings/company', 'PATCH', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-settings'] }),
  });
}

export function useStartBillingCheckout() {
  return useMutation({
    mutationFn: (payload: { idempotency_key: string }) =>
      sendWithAuth<BillingCheckoutResponse>('/api/billing/create-checkout-session', 'POST', payload),
  });
}
