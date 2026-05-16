import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDriverApp } from '@/hooks/useDriverApp';

function formatStamp(value?: string | null) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SyncPage() {
  const {
    clearOfflineDraft,
    currentRoute,
    isOnline,
    lastSyncedAt,
    offlineRoutePackStatus,
    prepareOfflineRoute,
    preparingOfflineRoute,
    queuedStopNoteCount,
    queuedTemperatureLogCount,
    stopDrafts,
    clearOfflineDrafts,
    refreshOfflineDrafts,
    routeInvoices,
    syncOfflineWork,
  } = useDriverApp();
  const [syncing, setSyncing] = useState(false);

  const currentPackReady = offlineRoutePackStatus?.routeId === currentRoute?.id ? offlineRoutePackStatus : null;
  const queuedTotal = queuedStopNoteCount + queuedTemperatureLogCount;

  useEffect(() => {
    refreshOfflineDrafts();
    // Refresh once on page entry so the sync center reflects the latest local drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleVisibilityRefresh() {
      if (document.visibilityState === 'visible') {
        refreshOfflineDrafts();
      }
    }

    window.addEventListener('focus', refreshOfflineDrafts);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    return () => {
      window.removeEventListener('focus', refreshOfflineDrafts);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [refreshOfflineDrafts]);

  async function handleManualSync() {
    setSyncing(true);
    try {
      await syncOfflineWork();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-[2rem] bg-white p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Driver Sync Center</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">{isOnline ? 'Connected' : 'Offline mode'}</h2>
        <p className="mt-2 text-sm text-slate-600">
          See what is cached on this device, what is waiting to sync, and when your route was refreshed last.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
          <span className={`rounded-full px-3 py-1 ${isOnline ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            Last route sync {formatStamp(lastSyncedAt)}
          </span>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="rounded-[2rem] bg-white p-5 shadow-card">
          <p className="text-sm font-semibold text-ink">Queued work</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Temp logs</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{queuedTemperatureLogCount}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Stop notes</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{queuedStopNoteCount}</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            {queuedTotal
              ? `${queuedTotal} update${queuedTotal === 1 ? '' : 's'} will sync automatically when service returns.`
              : 'No queued driver work is waiting right now.'}
          </p>
          <button
            type="button"
            disabled={!isOnline || syncing || queuedTotal === 0}
            onClick={() => void handleManualSync()}
            className="mt-4 min-h-12 w-full rounded-2xl bg-ocean px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
          >
            {syncing ? 'Syncing queued work...' : 'Sync queued work now'}
          </button>
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-card">
          <p className="text-sm font-semibold text-ink">Offline route pack</p>
          <p className="mt-2 text-sm text-slate-600">
            Store the active route and invoice paperwork on this device before heading into low-signal areas.
          </p>
          <div className="mt-4 rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">
            <p><strong>Route:</strong> {currentRoute?.name || 'No active route selected'}</p>
            <p className="mt-2"><strong>Stops cached:</strong> {currentRoute?.stops.length || 0}</p>
            <p className="mt-2"><strong>Invoice PDFs on this run:</strong> {routeInvoices.length}</p>
            <p className="mt-2">
              <strong>Prepared:</strong> {currentPackReady ? formatStamp(currentPackReady.preparedAt) : 'Not prepared for this route yet'}
            </p>
            {currentPackReady ? (
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                Ready with {currentPackReady.invoiceCount} cached invoice PDF{currentPackReady.invoiceCount === 1 ? '' : 's'}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={preparingOfflineRoute || !currentRoute}
            onClick={() => void prepareOfflineRoute()}
            className="mt-4 min-h-12 w-full rounded-2xl bg-white px-4 py-3 text-base font-semibold text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
          >
            {preparingOfflineRoute ? 'Saving offline pack...' : 'Prepare offline route pack'}
          </button>
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Saved stop drafts</p>
              <p className="mt-2 text-sm text-slate-600">
                Proof photos and note drafts that are still stored on this device.
              </p>
            </div>
            <button
              type="button"
              disabled={!stopDrafts.length}
              onClick={clearOfflineDrafts}
              className="min-h-12 rounded-2xl px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
            >
              Clear drafts
            </button>
          </div>
          {stopDrafts.length ? (
            <div className="mt-4 space-y-3">
              {stopDrafts.map((draft) => (
                <div key={draft.stopId} className="rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">
                  <p><strong>Stop ID:</strong> {draft.stopId}</p>
                  <p className="mt-2"><strong>Updated:</strong> {formatStamp(draft.updatedAt)}</p>
                  <p className="mt-2"><strong>Notes:</strong> {draft.notes.trim() ? 'Saved' : 'None'}</p>
                  <p className="mt-2"><strong>Proof photo:</strong> {draft.proofImage ? 'Saved on device' : 'None'}</p>
                  {draft.notes.trim() ? (
                    <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                      {draft.notes.trim()}
                    </p>
                  ) : null}
                  <Link
                    to={`/stops/${draft.stopId}`}
                    className="mt-3 inline-flex min-h-10 items-center rounded-2xl bg-white px-4 text-sm font-semibold text-slate-800 ring-1 ring-slate-200"
                  >
                    Open stop draft
                  </Link>
                  <button
                    type="button"
                    onClick={() => clearOfflineDraft(draft.stopId)}
                    className="mt-3 ml-2 inline-flex min-h-10 items-center rounded-2xl px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"
                  >
                    Remove draft
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">
              No saved stop drafts are sitting on this device right now.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
