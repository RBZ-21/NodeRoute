import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BottomNav } from '@/components/BottomNav';
import { InstallPrompt } from '@/components/InstallPrompt';
import { useDriverApp } from '@/hooks/useDriverApp';
import { DRIVER_LOCAL_DATA_RETENTION_NOTICE } from '@/lib/storage';

export function AppShell() {
  const { currentRoute, isOnline, lastSyncedAt, logout, queuedStatusCount, queuedStopNoteCount, queuedTemperatureLogCount, user, usingCachedData } = useDriverApp();
  const location = useLocation();
  const navigate = useNavigate();
  const isDetail = location.pathname.startsWith('/stops/');
  const syncLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <div className="min-h-screen bg-shell text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-6 pt-4">
        <header className="rounded-[2rem] bg-[radial-gradient(circle_at_top,_rgba(211,243,239,0.95),_rgba(244,247,248,0.92)_60%,_rgba(244,247,248,1)_100%)] p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">NodeRoute Driver</p>
              <h1 className="mt-2 text-2xl font-semibold">{isDetail ? 'Stop Detail' : currentRoute?.name || 'Today’s Route'}</h1>
              <p className="mt-2 text-sm text-slate-600">
                {user?.name || 'Driver'}{currentRoute?.stops?.length ? ` · ${currentRoute.stops.length} stops` : ''}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
                <span className={`rounded-full px-3 py-1 ${isOnline ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
                {syncLabel ? (
                  <span className="rounded-full bg-white/80 px-3 py-1 text-slate-600">
                    Last synced {syncLabel}
                  </span>
                ) : null}
                {queuedTemperatureLogCount > 0 ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                    {queuedTemperatureLogCount} temp log{queuedTemperatureLogCount === 1 ? '' : 's'} queued
                  </span>
                ) : null}
                {queuedStopNoteCount > 0 ? (
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-800">
                    {queuedStopNoteCount} stop note{queuedStopNoteCount === 1 ? '' : 's'} queued
                  </span>
                ) : null}
                {queuedStatusCount > 0 ? (
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">
                    {queuedStatusCount} status action{queuedStatusCount === 1 ? '' : 's'} queued
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="min-h-12 rounded-2xl bg-white px-4 text-sm font-semibold text-slate-700"
            >
              Log out
            </button>
          </div>
          {usingCachedData && (
            <p className="mt-4 rounded-2xl bg-sand px-3 py-2 text-sm font-medium text-amber-900">
              Showing your last synced route because the network is unavailable. Route details stay available offline until the next sync.
            </p>
          )}
          {!isOnline && (
            <p className="mt-4 rounded-2xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950">
              Offline: stop status changes, notes, proof, and temperature logs will queue on this device and sync when service returns.
            </p>
          )}
          {!isDetail && <div className="mt-4"><InstallPrompt /></div>}
          <p className="mt-4 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-600">
            {DRIVER_LOCAL_DATA_RETENTION_NOTICE}
          </p>
        </header>
        <main className="flex-1 pb-6 pt-4">
          <Outlet />
        </main>
      </div>
      {!isDetail && <BottomNav />}
    </div>
  );
}
