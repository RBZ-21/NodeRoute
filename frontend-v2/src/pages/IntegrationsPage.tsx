import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { type IntegrationCard, useIntegrationAction, useIntegrationLogs, useIntegrations } from '../hooks/useIntegrations';

const knownIntegrations = ['Stripe', 'QuickBooks', 'Supabase', 'Email (SMTP)', 'PDF Service'];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const statusColors = { connected: 'green', disconnected: 'gray', error: 'red' } as const;

export function IntegrationsPage() {
  const { data, isLoading } = useIntegrations();
  const cards = useMemo(() => data?.cards ?? [], [data]);
  const endpoint = data?.endpoint ?? '';
  const endpointUnavailable = data?.endpointUnavailable ?? false;

  const runAction = useIntegrationAction(endpoint);
  const viewLogsM = useIntegrationLogs(endpoint);

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const mergedCards = useMemo(() => {
    const byName = new Map<string, IntegrationCard>();
    for (const card of cards) byName.set(card.name, card);
    for (const name of knownIntegrations) {
      if (!byName.has(name)) byName.set(name, { id: slugify(name), name, status: 'disconnected', lastSync: '' });
    }
    return Array.from(byName.values());
  }, [cards]);

  async function handleAction(card: IntegrationCard, action: 'connect' | 'disconnect' | 'sync') {
    setError(''); setNotice('');
    if (!endpoint || endpointUnavailable) { setNotice(`Integration API is not available yet for ${card.name}.`); return; }
    try {
      await runAction.mutateAsync({ id: card.id, action });
      setNotice(`${card.name}: ${action} completed.`);
    } catch (err) { setError(String((err as Error)?.message || `Could not ${action} integration`)); }
  }

  async function handleLogs(card: IntegrationCard) {
    setError(''); setNotice('');
    if (!endpoint || endpointUnavailable) { setNotice(`Integration logs are unavailable until API endpoints are enabled for ${card.name}.`); return; }
    try {
      const response = await viewLogsM.mutateAsync(card.id);
      const url = String(response.url || response.logUrl || response.log_url || '').trim();
      if (url) { window.open(url, '_blank', 'noopener,noreferrer'); setNotice(`Opened logs for ${card.name}.`); }
      else setNotice(`No log URL returned for ${card.name}.`);
    } catch (err) { setError(String((err as Error)?.message || 'Could not load integration logs')); }
  }

  return (
    <div className="space-y-5">
      {isLoading && <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading integrations...</div>}
      {error && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Systems connectivity and sync controls from <span className="font-semibold">{endpoint || 'static integration catalog'}</span>.</CardDescription>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {mergedCards.map((card) => {
          const pending = runAction.isPending || viewLogsM.isPending;
          const initials = card.name.split(/\s+/).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase();
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
                  <Button size="sm" onClick={() => handleAction(card, 'connect')} disabled={pending || card.status === 'connected'}>Connect</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleAction(card, 'disconnect')} disabled={pending || card.status === 'disconnected'}>Disconnect</Button>
                  <Button variant="secondary" size="sm" onClick={() => handleAction(card, 'sync')} disabled={pending}>Sync Now</Button>
                  <Button variant="outline" size="sm" onClick={() => handleLogs(card)} disabled={pending}>View Logs</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
