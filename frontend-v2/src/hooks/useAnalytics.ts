import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export type RollupRow = {
  label: string;
  order_count: number;
  invoice_count: number;
  revenue: number;
  estimated_cost: number;
  margin: number;
  margin_pct: number;
  qty: number;
};

export type RollupsResponse = {
  generated_at?: string;
  filters?: { start?: string | null; end?: string | null; limit?: number };
  overview: {
    order_count: number;
    invoice_count: number;
    revenue: number;
    estimated_cost: number;
    margin: number;
    margin_pct: number;
  };
  customer: RollupRow[];
  route: RollupRow[];
  driver: RollupRow[];
  sku: RollupRow[];
};

export function useAnalyticsRollups(startDate: string, endDate: string, limit: string) {
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 12));
  return useQuery<RollupsResponse>({
    queryKey: ['analytics-rollups', startDate, endDate, limitNum],
    queryFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set('start', startDate);
      if (endDate) params.set('end', endDate);
      params.set('limit', String(limitNum));
      return fetchWithAuth<RollupsResponse>(`/api/reporting/rollups?${params.toString()}`);
    },
    enabled: !!(startDate || endDate),
    staleTime: 30_000,
  });
}
