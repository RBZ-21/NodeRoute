import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListWithAuth, getUserRole, sendWithAuth } from '../lib/api';

export type AiInsightType = 'anomaly' | 'reorder' | 'collections';

export interface AiInsight {
  id: string;
  company_id: string | null;
  type: AiInsightType;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  payload: { count?: number; summary?: string } & Record<string, unknown>;
  created_at: string;
  acknowledged_at: string | null;
}

function canSeeInsights() {
  const role = getUserRole();
  return role === 'admin' || role === 'manager' || role === 'superadmin';
}

/** Unacknowledged proactive AI insights for the active company. */
export function useAiInsights() {
  return useQuery<AiInsight[]>({
    queryKey: ['ai-insights'],
    queryFn: () =>
      // Insights are a non-critical widget: swallow errors so a failed fetch
      // never blocks the page, but validate shape at the API boundary.
      fetchListWithAuth<AiInsight>('/api/ai-insights').catch(() => []),
    enabled: canSeeInsights(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useAcknowledgeInsight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (insightId: string) =>
      sendWithAuth(`/api/ai-insights/${insightId}/acknowledge`, 'POST'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-insights'] }),
  });
}
