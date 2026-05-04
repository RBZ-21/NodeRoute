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
  orderCutoffHour?: number;
  orderCutoffDay?: string;
  cutoffHourOptions?: CutoffOption[];
  cutoffDayOptions?: CutoffOption[];
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: () => fetchCurrentUser<CurrentUser>(),
  });
}

export function useCompanySettings() {
  return useQuery({
    queryKey: ['company-settings'],
    queryFn: () => fetchWithAuth<CompanySettings>('/api/settings/company'),
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
