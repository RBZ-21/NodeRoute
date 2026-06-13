import { RefreshCw } from 'lucide-react';

/**
 * "Live · updated HH:MM:SS" status chip shown on pages that auto-refresh
 * their data (30s polling via TanStack Query refetchInterval). Includes a
 * small manual refresh icon as a fallback.
 */
export function LiveIndicator({
  updatedAt,
  onRefresh,
  refreshing,
}: {
  /** Epoch ms of the last successful data refresh (query.dataUpdatedAt). */
  updatedAt?: number;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const timeLabel = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('en-US', { hour12: false })
    : '—';
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span>
        Live · updated <span className="font-mono tabular-nums">{timeLabel}</span>
      </span>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh now"
        title="Refresh now"
        className="rounded p-1 transition-colors hover:bg-muted hover:text-foreground"
        disabled={refreshing}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
