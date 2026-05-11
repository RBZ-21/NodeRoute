import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type ReorderAlert = {
  item_number: string;
  description: string;
  urgency: 'CRITICAL' | 'WARNING' | 'LOW';
  days_until_stockout: number;
  suggested_order_qty: number;
  unit: string;
  reason: string;
};
export type ReorderAlertsResult = { alerts: ReorderAlert[]; summary: string };

export type LatePaymentRisk = {
  customer_name: string;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  risk_score: number;
  flag_reason: string;
  recommended_action: string;
};
export type LatePaymentRiskResult = { risks: LatePaymentRisk[]; summary: string };

export type PricingAnomaly = {
  order_id: string;
  order_number?: string;
  customer_name?: string;
  item_number: string;
  description: string;
  sale_price: number;
  avg_price: number;
  pct_below: number;
  severity: 'HIGH' | 'MEDIUM';
};
export type PricingAnomaliesResult = { anomalies: PricingAnomaly[]; summary: string; lookback_days: number };

export type VendorScore = {
  vendor: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  strengths: string[];
  risks: string[];
};
export type VendorPerformanceResult = { scores: VendorScore[]; summary: string };

export function useReorderAlerts(enabled = false) {
  return useQuery<ReorderAlertsResult>({
    queryKey: ['ai', 'reorder-alerts'],
    queryFn: () => fetchWithAuth<ReorderAlertsResult>('/api/ai/reorder-alerts'),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useLatePaymentRisk(enabled = false) {
  return useQuery<LatePaymentRiskResult>({
    queryKey: ['ai', 'late-payment-risk'],
    queryFn: () => fetchWithAuth<LatePaymentRiskResult>('/api/ai/late-payment-risk'),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function usePricingAnomalies() {
  return useMutation({
    mutationFn: (days = 30) =>
      sendWithAuth<PricingAnomaliesResult>('/api/ai/pricing-anomalies', 'POST', { days }),
  });
}

export function useVendorPerformance(enabled = false) {
  return useQuery<VendorPerformanceResult>({
    queryKey: ['ai', 'vendor-performance'],
    queryFn: () => fetchWithAuth<VendorPerformanceResult>('/api/ai/vendor-performance'),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function useAIChat() {
  return useMutation({
    mutationFn: ({ message, history }: { message: string; history: ChatMessage[] }) =>
      sendWithAuth<{ reply: string }>('/api/ai/chat', 'POST', { message, history }),
  });
}
