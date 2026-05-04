import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type Vendor = {
  id?: string | number;
  vendorId?: string;
  vendor_id?: string;
  name?: string;
  contact?: string;
  contactName?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  category?: string;
  activePOs?: number | string;
  active_pos?: number | string;
  status?: string;
  address?: string;
  notes?: string;
  payment_terms?: string;
};

export function useVendorsQuery() {
  return useQuery({
    queryKey: ['vendors'] as const,
    queryFn: () =>
      fetchWithAuth<Vendor[]>('/api/vendors').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 30_000,
  });
}

export function useSaveVendorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: string | number; draft: unknown }) =>
      sendWithAuth<Vendor>(`/api/vendors/${id}`, 'PATCH', draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}
