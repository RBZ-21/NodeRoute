import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type Delivery = {
  id?: number;
  userFacingId?: string;
  orderDbId?: string;
  orderId?: string;
  restaurantName?: string;
  driverName?: string;
  status?: string;
  routeId?: string | null;
  expectedWindowEnd?: string;
  createdAt?: string;
  lat?: number | string | null;
  lng?: number | string | null;
};

export function useDeliveries() {
  return useQuery<Delivery[]>({
    queryKey: ['deliveries'],
    queryFn: () => fetchWithAuth<Delivery[]>('/api/deliveries').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 30_000,
  });
}

export function useUpdateDeliveryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      sendWithAuth(`/api/deliveries/${id}/status`, 'PATCH', { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
  });
}
