import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListWithAuth, sendWithAuth } from '../lib/api';

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
  catalog_item_numbers?: string[];
  activePOs?: number | string;
  active_pos?: number | string;
  status?: string;
  address?: string;
  notes?: string;
  payment_terms?: string;
  min_order_value?: number | string | null;
  pallet_qty?: number | string | null;
  layer_qty?: number | string | null;
  lead_time_days?: number | string | null;
  seasonal_usage_windows?: unknown[] | string | null;
};

export function useVendorsQuery() {
  return useQuery({
    queryKey: ['vendors'] as const,
    queryFn: () =>
      fetchListWithAuth<Vendor>('/api/vendors'),
    staleTime: 30_000,
  });
}

export function useSaveVendorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id?: string | number; draft: unknown }) =>
      id
        ? sendWithAuth<Vendor>(`/api/vendors/${id}`, 'PATCH', draft)
        : sendWithAuth<Vendor>('/api/vendors', 'POST', draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}
