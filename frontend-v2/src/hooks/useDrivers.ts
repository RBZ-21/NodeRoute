import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type DriverStatus = 'active' | 'off-duty' | 'on-break' | 'other';

export type Driver = {
  id?: string | number;
  driverId?: string;
  driver_id?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  status?: string;
  assignedRoute?: string;
  assigned_route?: string;
  routeId?: string;
  route_id?: string;
  vehicle?: string;
  vehicleName?: string;
  vehicle_name?: string;
  lastLocation?: string;
  last_location?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  license_number?: string;
  notes?: string;
};

export function useDrivers() {
  return useQuery<Driver[]>({
    queryKey: ['drivers'],
    queryFn: () => fetchWithAuth<Driver[]>('/api/drivers').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 30_000,
  });
}

export function useUpdateDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string | number; patch: Partial<Driver> }) =>
      sendWithAuth<Driver>(`/api/drivers/${id}`, 'PATCH', patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });
}
