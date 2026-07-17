import { useQuery } from '@tanstack/react-query';
import { fetchListWithAuth, fetchWithAuth } from '../lib/api';

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
  route_id?: string;
  routeId?: string;
  customer_id?: string | number | null;
  address?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string;
  driver?: string;
};

export type DriveTimePair = {
  key: string;
  from: string | null | undefined;
  to: string | number | null | undefined;
};

export type DriveTime = {
  duration_seconds: number;
  distance_meters: number;
  cached?: boolean;
};

export type RoutePolylineStop = {
  stop_id: string;
  sequence: number;
  name?: string;
  address?: string;
  lat: number;
  lng: number;
  duration_seconds?: number | null;
  distance_meters?: number | null;
};

export type RoutePolyline = {
  route_id: string;
  encoded_polyline: string | null;
  stops: RoutePolylineStop[];
};

export function useMapDrivers() {
  return useQuery({
    queryKey: ['map-drivers'],
    queryFn: () => fetchListWithAuth<DriverLocation>('/api/drivers'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useMapStops() {
  return useQuery({
    queryKey: ['map-stops'],
    queryFn: () => fetchListWithAuth<StopMarker>('/api/stops'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

function normalizedDriveTimePair(pair: DriveTimePair, mode: string) {
  const from = pair.from || '';
  const to = pair.to == null ? '' : String(pair.to);
  return {
    key: pair.key,
    from,
    to,
    requestKey: `${from}\u0000${to}\u0000${mode}`,
  };
}

export function useDriveTimes(pairs: DriveTimePair[], mode = 'driving') {
  const normalizedPairs = pairs.map((pair) => normalizedDriveTimePair(pair, mode));
  const validPairs = normalizedPairs.filter((pair) => pair.from && pair.to);
  const lookupKey = normalizedPairs
    .map((pair) => `${pair.key}:${pair.from}:${pair.to}`)
    .join('|');

  return useQuery({
    queryKey: ['drive-times', mode, lookupKey],
    enabled: validPairs.length > 0,
    queryFn: async () => {
      const result: Record<string, DriveTime | null> = Object.fromEntries(
        normalizedPairs.map((pair) => [pair.key, null]),
      );
      const requests = new Map<string, Promise<DriveTime | null>>();

      for (const pair of validPairs) {
        if (requests.has(pair.requestKey)) continue;
        requests.set(
          pair.requestKey,
          fetchWithAuth<DriveTime>(
            `/api/maps/drive-time?from=${encodeURIComponent(pair.from)}&to=${encodeURIComponent(pair.to)}&mode=${encodeURIComponent(mode)}`,
          ).catch(() => null),
        );
      }

      const resolved = new Map<string, DriveTime | null>();
      await Promise.all(
        [...requests.entries()].map(async ([key, request]) => {
          resolved.set(key, await request);
        }),
      );

      for (const pair of validPairs) {
        result[pair.key] = resolved.get(pair.requestKey) ?? null;
      }

      return result;
    },
    staleTime: 60_000,
  });
}

export function useRoutePolyline(routeId: string | null | undefined) {
  return useQuery({
    queryKey: ['route-polyline', routeId || ''],
    enabled: !!routeId,
    queryFn: () => fetchWithAuth<RoutePolyline>(`/api/maps/route/${encodeURIComponent(routeId || '')}`),
    staleTime: 30_000,
  });
}
