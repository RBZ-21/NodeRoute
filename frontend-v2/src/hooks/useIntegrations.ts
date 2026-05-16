import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'other';

export type IntegrationCard = {
  id: string;
  name: string;
  status: IntegrationStatus;
  lastSync: string;
};

const knownIntegrations = ['Stripe', 'QuickBooks', 'Supabase', 'Email (SMTP)', 'PDF Service'];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function normalizeStatus(value: string | undefined): IntegrationStatus {
  const s = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (s === 'connected') return 'connected';
  if (s === 'disconnected') return 'disconnected';
  if (s === 'error') return 'error';
  return 'other';
}

function pickString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function toCard(raw: unknown, index: number): IntegrationCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = pickString(r, ['name', 'integrationName', 'integration_name'], `Integration ${index + 1}`);
  return {
    id: pickString(r, ['id', 'key', 'slug'], slugify(name)),
    name,
    status: normalizeStatus(pickString(r, ['status', 'state'], 'disconnected')),
    lastSync: pickString(r, ['lastSync', 'last_sync', 'syncedAt', 'synced_at']),
  };
}

function parseCards(data: unknown): IntegrationCard[] {
  if (Array.isArray(data)) return data.map(toCard).filter((c): c is IntegrationCard => !!c);
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  for (const key of ['integrations', 'items', 'data']) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).map(toCard).filter((c): c is IntegrationCard => !!c);
  }
  return [];
}

function buildStaticCards(): IntegrationCard[] {
  return knownIntegrations.map((name) => ({ id: slugify(name), name, status: 'disconnected' as IntegrationStatus, lastSync: '' }));
}

async function fetchIntegrations(): Promise<{ cards: IntegrationCard[]; endpoint: string; endpointUnavailable: boolean }> {
  try {
    const data = await fetchWithAuth<unknown>('/api/integrations');
    return { endpoint: '/api/integrations', cards: parseCards(data), endpointUnavailable: false };
  } catch {
    try {
      const data = await fetchWithAuth<unknown>('/api/settings/integrations');
      return { endpoint: '/api/settings/integrations', cards: parseCards(data), endpointUnavailable: false };
    } catch {
      return { endpoint: '', cards: buildStaticCards(), endpointUnavailable: true };
    }
  }
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
    staleTime: 30_000,
  });
}

export function useIntegrationAction(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'connect' | 'disconnect' | 'sync' }) =>
      sendWithAuth(`${endpoint}/${encodeURIComponent(id)}/${action}`, 'POST'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useIntegrationLogs(endpoint: string) {
  return useMutation({
    mutationFn: (id: string) =>
      fetchWithAuth<{ url?: string; logUrl?: string; log_url?: string }>(`${endpoint}/${encodeURIComponent(id)}/logs`),
  });
}
