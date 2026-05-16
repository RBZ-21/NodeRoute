import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type StopStatus = 'pending' | 'arrived' | 'completed' | 'failed' | 'other';

export type StopRecord = {
  id?: string | number;
  stopNumber?: number | string;
  stop_number?: number | string;
  routeId?: string;
  route_id?: string;
  address?: string;
  customer?: string;
  customerName?: string;
  customer_name?: string;
  orderNumber?: string;
  order_number?: string;
  status?: string;
  arrivalTime?: string;
  arrival_time?: string;
  driverNotes?: string;
  driver_notes?: string;
  door_code?: string;
  mapUrl?: string;
  map_url?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  createdAt?: string;
  created_at?: string;
};

export function useStops(routeIdParam?: string) {
  return useQuery<StopRecord[]>({
    queryKey: ['stops', routeIdParam ?? ''],
    queryFn: () => {
      const query = routeIdParam ? `?routeId=${encodeURIComponent(routeIdParam)}` : '';
      return fetchWithAuth<StopRecord[]>(`/api/stops${query}`).then((d) => (Array.isArray(d) ? d : []));
    },
    staleTime: 30_000,
  });
}

export function useUpdateStop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string | number; patch: Record<string, unknown> }) =>
      sendWithAuth(`/api/stops/${id}`, 'PATCH', patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stops'] }),
  });
}
