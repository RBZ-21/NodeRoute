import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type RuleStatus = 'active' | 'inactive' | 'draft' | 'other';

export type PlanningRule = {
  id: string;
  name: string;
  type: string;
  condition: string;
  action: string;
  priority: number;
  status: RuleStatus;
};

function pickString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function normalizeStatus(value: string | undefined): RuleStatus {
  const s = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (s === 'active') return 'active';
  if (s === 'inactive') return 'inactive';
  if (s === 'draft') return 'draft';
  return 'other';
}

function toRule(raw: unknown, index: number): PlanningRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: pickString(r, ['id', 'ruleId', 'rule_id'], `RULE-${index + 1}`),
    name: pickString(r, ['name', 'ruleName', 'rule_name'], `Rule ${index + 1}`),
    type: pickString(r, ['type', 'ruleType', 'rule_type'], 'General'),
    condition: pickString(r, ['condition', 'when', 'criteria'], '-'),
    action: pickString(r, ['action', 'then', 'outcome'], '-'),
    priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0,
    status: normalizeStatus(pickString(r, ['status', 'state'])),
  };
}

function parseRules(data: unknown): PlanningRule[] {
  if (Array.isArray(data)) return data.map(toRule).filter((r): r is PlanningRule => !!r);
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  for (const key of ['rules', 'items', 'data']) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).map(toRule).filter((r): r is PlanningRule => !!r);
  }
  return [];
}

async function fetchRules(): Promise<{ rules: PlanningRule[]; endpoint: string; endpointUnavailable: boolean }> {
  try {
    const data = await fetchWithAuth<unknown>('/api/planning/rules');
    return { endpoint: '/api/planning/rules', rules: parseRules(data), endpointUnavailable: false };
  } catch {
    try {
      const data = await fetchWithAuth<unknown>('/api/settings/rules');
      return { endpoint: '/api/settings/rules', rules: parseRules(data), endpointUnavailable: false };
    } catch {
      return { endpoint: '', rules: [], endpointUnavailable: true };
    }
  }
}

export function usePlanningRules() {
  return useQuery({
    queryKey: ['planning-rules'],
    queryFn: fetchRules,
  });
}

export function useToggleRule(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: RuleStatus }) =>
      sendWithAuth(`${endpoint}/${encodeURIComponent(id)}`, 'PATCH', { status: nextStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planning-rules'] }),
  });
}

export function useDeleteRule(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendWithAuth(`${endpoint}/${encodeURIComponent(id)}`, 'DELETE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planning-rules'] }),
  });
}
