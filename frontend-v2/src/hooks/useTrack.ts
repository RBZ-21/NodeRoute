import { useQuery } from '@tanstack/react-query';

export type TrackingData = {
  orderId: string;
  orderNumber: string;
  status: string;
  deliveryAddress: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  stopsBeforeYou: number;
  totalRouteStops: number;
  driver: {
    name: string;
    lat: number;
    lng: number;
    heading: number;
    speed_mph: number;
    updatedAt: string | null;
  };
  destination: { lat: number | null; lng: number | null };
  eta: {
    totalMinutes: number;
    driveMinutes: number;
    dwellMinutes: number;
    etaTime: string;
  } | null;
};

export type TrackFetchState = 'loading' | 'error' | 'expired' | 'notfound' | 'ready';

async function fetchTrackingData(token: string): Promise<TrackingData> {
  const res = await fetch(`/api/track/${encodeURIComponent(token)}`);
  if (res.status === 410) throw Object.assign(new Error('expired'), { code: 410 });
  if (res.status === 404) throw Object.assign(new Error('notfound'), { code: 404 });
  if (!res.ok) {
    const j = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(j.error || 'Unexpected error');
  }
  return res.json() as Promise<TrackingData>;
}

export function useTrackingData(token: string) {
  return useQuery({
    queryKey: ['track', token],
    queryFn: () => fetchTrackingData(token),
    enabled: !!token,
    refetchInterval: 30_000,
    retry: false,
  });
}
