import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BottomNav } from '@/components/BottomNav';
import { InstallPrompt } from '@/components/InstallPrompt';
import { useDriverApp } from '@/hooks/useDriverApp';

export function AppShell() {
  const { currentRoute, logout, user, usingCachedData } = useDriverApp();
  const location = useLocation();
  const navigate = useNavigate();
  const isDetail = location.pathname.startsWith('/stops/');

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
              Showing your last synced route because the network is unavailable.
            </p>
          )}
          {!isDetail && <div className="mt-4"><InstallPrompt /></div>}
        </header>
        <main className="flex-1 pb-6 pt-4">
          <Outlet />
        </main>
      </div>
      {!isDetail && <BottomNav />}
    </div>
  );
}
