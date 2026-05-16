import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export type DriverLocation = {
  id?: string | number;
  driver_id?: string;
  driverId?: string;
  name?: string;
  full_name?: string;
  fullName?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string;
  current_stop?: string;
  currentStop?: string;
  route_id?: string;
  routeId?: string;
};

export type StopMarker = {
  id?: string | number;
  stop_id?: string;
  stopId?: string;
  address?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string;
  driver?: string;
};

export function useMapDrivers() {
  return useQuery({
    queryKey: ['map-drivers'],
    queryFn: () => fetchWithAuth<DriverLocation[]>('/api/drivers'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useMapStops() {
  return useQuery({
    queryKey: ['map-stops'],
    queryFn: () => fetchWithAuth<StopMarker[]>('/api/stops'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
