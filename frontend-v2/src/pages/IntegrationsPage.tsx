import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'other';

type IntegrationCard = {
  id: string;
  name: string;
  status: IntegrationStatus;
  lastSync: string;
};

type IntegrationLogResponse = {
  url?: string;
  logUrl?: string;
  log_url?: string;
};

const statusColors = {
  connected: 'green',
  disconnected: 'gray',
  error: 'red',
} as const;

const knownIntegrations = ['Stripe', 'QuickBooks', 'Supabase', 'Email (SMTP)', 'PDF Service'];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeStatus(value: string | undefined): IntegrationStatus {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'connected') return 'connected';
  if (normalized === 'disconnected') return 'disconnected';
  if (normalized === 'error') return 'error';
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
  const record = raw as Record<string, unknown>;
  const name = pickString(record, ['name', 'integrationName', 'integration_name'], `Integration ${index + 1}`);
  const id = pickString(record, ['id', 'key', 'slug'], slugify(name));
  return {
    id,
    name,
    status: normalizeStatus(pickString(record, ['status', 'state'], 'disconnected')),
    lastSync: pickString(record, ['lastSync', 'last_sync', 'syncedAt', 'synced_at']),
  };
}

function parseCards(data: unknown): IntegrationCard[] {
  if (Array.isArray(data)) {
    return data.map(toCard).filter((card): card is IntegrationCard => !!card);
  }
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  const candidates = [root.integrations, root.items, root.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(toCard).filter((card): card is IntegrationCard => !!card);
    }
  }
  return [];
}

function buildStaticCards(): IntegrationCard[] {
  return knownIntegrations.map((name) => ({
    id: slugify(name),
    name,
    status: 'disconnected',
    lastSync: '',
  }));
}

async function loadIntegrationsData() {
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

export function IntegrationsPage() {
  const [cards, setCards] = useState<IntegrationCard[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [endpointUnavailable, setEndpointUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingById, setPendingById] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await loadIntegrationsData();
      setEndpoint(response.endpoint);
      setEndpointUnavailable(response.endpointUnavailable);
      setCards(response.cards);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load integrations'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const mergedCards = useMemo(() => {
    const byName = new Map<string, IntegrationCard>();
    for (const card of cards) {
      byName.set(card.name, card);
    }
    for (const name of knownIntegrations) {
      if (!byName.has(name)) {
        byName.set(name, {
          id: slugify(name),
          name,
          status: 'disconnected',
          lastSync: '',
        });
      }
    }
    return Array.from(byName.values());
  }, [cards]);

  function setPending(id: string, action: string | null) {
    setPendingById((current) => {
      if (!action) {
        const { [id]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: action };
    });
  }

  function updateCardStatus(id: string, nextStatus: IntegrationStatus) {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, status: nextStatus, lastSync: nextStatus === 'connected' ? new Date().toISOString() : card.lastSync } : card)));
  }

  async function runAction(card: IntegrationCard, action: 'connect' | 'disconnect' | 'sync') {
    setError('');
    setNotice('');
    if (!endpoint || endpointUnavailable) {
      setNotice(`Integration API is not available yet for ${card.name}.`);
      return;
    }
    setPending(card.id, action);
    try {
      await sendWithAuth(`${endpoint}/${encodeURIComponent(card.id)}/${action}`, 'POST');
      if (action === 'connect') updateCardStatus(card.id, 'connected');
      if (action === 'disconnect') updateCardStatus(card.id, 'disconnected');
      if (action === 'sync') {
        setCards((current) => current.map((currentCard) => (currentCard.id === card.id ? { ...currentCard, lastSync: new Date().toISOString() } : currentCard)));
      }
      setNotice(`${card.name}: ${action} completed.`);
    } catch (err) {
      setError(String((err as Error).message || `Could not ${action} integration`));
    } finally {
      setPending(card.id, null);
    }
  }

  async function viewLogs(card: IntegrationCard) {
    setError('');
    setNotice('');
    if (!endpoint || endpointUnavailable) {
      setNotice(`Integration logs are unavailable until API endpoints are enabled for ${card.name}.`);
      return;
    }
    setPending(card.id, 'logs');
    try {
      const response = await fetchWithAuth<IntegrationLogResponse>(`${endpoint}/${encodeURIComponent(card.id)}/logs`);
      const url = String(response.url || response.logUrl || response.log_url || '').trim();
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        setNotice(`Opened logs for ${card.name}.`);
      } else {
        setNotice(`No log URL returned for ${card.name}.`);
      }
    } catch (err) {
      setError(String((err as Error).message || 'Could not load integration logs'));
    } finally {
      setPending(card.id, null);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading integrations...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Integrations</CardTitle>
            <CardDescription>
              Systems connectivity and sync controls from <span className="font-semibold">{endpoint || 'static integration catalog'}</span>.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {mergedCards.map((card) => {
          const pending = !!pendingById[card.id];
          const initials = card.name
            .split(/\s+/)
            .map((part) => part.charAt(0))
            .join('')
            .slice(0, 2)
            .toUpperCase();

          return (
            <Card key={card.id}>
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold">{initials}</div>
                    <div>
                      <CardTitle className="text-lg">{card.name}</CardTitle>
                      <CardDescription>{card.lastSync ? `Last sync: ${new Date(card.lastSync).toLocaleString()}` : 'Last sync: Never'}</CardDescription>
                    </div>
                  </div>
                  <StatusBadge status={card.status} colorMap={statusColors} fallbackLabel="Unknown" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => runAction(card, 'connect')} disabled={pending || card.status === 'connected'}>
                    Connect
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => runAction(card, 'disconnect')} disabled={pending || card.status === 'disconnected'}>
                    Disconnect
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => runAction(card, 'sync')} disabled={pending}>
                    Sync Now
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => viewLogs(card)} disabled={pending}>
                    View Logs
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
