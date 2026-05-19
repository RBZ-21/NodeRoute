import { AlertTriangle, CheckCircle2, ExternalLink, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';

type StatuspageIncident = {
  id?: string;
  name?: string;
  status?: string;
  impact?: string;
  shortlink?: string;
  incident_updates?: Array<{ body?: string; created_at?: string }>;
};

type StatuspageSummary = {
  page?: { url?: string };
  status?: { indicator?: string; description?: string };
  incidents?: StatuspageIncident[];
  scheduled_maintenances?: StatuspageIncident[];
};

type BannerItem = StatuspageIncident & {
  type: 'incident' | 'maintenance';
};

const POLL_MS = 60 * 1000;
const DISMISS_KEY = 'nr_statuspage_dismissed';

function normalizeBaseUrl(value?: string) {
  return String(value || '').trim().replace(/\/$/, '');
}

function statuspageApiUrl() {
  const explicit = normalizeBaseUrl(import.meta.env.VITE_STATUSPAGE_API_URL);
  if (explicit) return explicit;

  const pageUrl = normalizeBaseUrl(import.meta.env.VITE_STATUSPAGE_URL);
  if (!pageUrl) return '';
  return `${pageUrl}/api/v2/summary.json`;
}

function statuspageDisplayUrl(summary?: StatuspageSummary) {
  return (
    normalizeBaseUrl(import.meta.env.VITE_STATUSPAGE_URL) ||
    normalizeBaseUrl(summary?.page?.url) ||
    ''
  );
}

function newestUpdate(item: BannerItem) {
  const updates = Array.isArray(item.incident_updates) ? item.incident_updates : [];
  return updates[0]?.body || '';
}

function itemKey(item: BannerItem, summary?: StatuspageSummary) {
  return [
    item.type,
    item.id || item.name || summary?.status?.indicator || 'statuspage',
    item.status || '',
  ].join(':');
}

function isActiveMaintenance(item: StatuspageIncident) {
  const status = String(item.status || '').toLowerCase();
  return ['scheduled', 'in_progress', 'verifying'].includes(status);
}

function pickBannerItem(summary: StatuspageSummary): BannerItem | null {
  const activeIncident = (summary.incidents || []).find((item) => {
    const status = String(item.status || '').toLowerCase();
    return status && !['resolved', 'postmortem'].includes(status);
  });
  if (activeIncident) return { ...activeIncident, type: 'incident' };

  const maintenance = (summary.scheduled_maintenances || []).find(isActiveMaintenance);
  if (maintenance) return { ...maintenance, type: 'maintenance' };

  return null;
}

function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
}

function writeDismissed(value: string) {
  try { localStorage.setItem(DISMISS_KEY, value); } catch {}
}

export function StatuspageBanner() {
  const apiUrl = useMemo(statuspageApiUrl, []);
  const [summary, setSummary] = useState<StatuspageSummary | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    if (!apiUrl) return undefined;
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(apiUrl, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json() as StatuspageSummary;
        if (!cancelled) setSummary(data);
      } catch {
        // Status visibility is useful but must never block the app shell.
      }
    }

    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiUrl]);

  if (!apiUrl || !summary) return null;

  const item = pickBannerItem(summary);
  const key = item ? itemKey(item, summary) : '';
  if (!item || dismissed === key) return null;

  const isMaintenance = item.type === 'maintenance';
  const displayUrl = statuspageDisplayUrl(summary);
  const detailUrl = item.shortlink || displayUrl;
  const statusText = summary.status?.description || (isMaintenance ? 'Scheduled maintenance' : 'Service incident');
  const updateText = newestUpdate(item);

  return (
    <aside
      aria-live="polite"
      className={[
        'fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-4xl rounded-lg border px-4 py-3 shadow-2xl sm:bottom-4',
        isMaintenance
          ? 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-50'
          : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isMaintenance ? <Wrench className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">{item.name || statusText}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-current dark:bg-black/20">
              <CheckCircle2 className="h-3 w-3" />
              {statusText}
            </span>
          </div>
          {updateText ? (
            <p className="mt-1 line-clamp-2 text-sm opacity-90">{updateText}</p>
          ) : null}
          {detailUrl ? (
            <a
              href={detailUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-2"
            >
              View status page
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-current hover:bg-white/50 dark:hover:bg-black/20"
          aria-label="Dismiss status notice"
          onClick={() => {
            writeDismissed(key);
            setDismissed(key);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}
