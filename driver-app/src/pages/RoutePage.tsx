import { LoadingCard } from '@/components/LoadingCard';
import { StopCard } from '@/components/StopCard';
import { useDriverApp } from '@/hooks/useDriverApp';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export function RoutePage() {
  const { currentRoute, loading, refreshData, refreshing, routes, selectedRouteId, setSelectedRouteId } = useDriverApp();
  const pullToRefresh = usePullToRefresh(async () => {
    await refreshData();
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
      </div>
    );
  }

  return (
    <section
      className="space-y-4 overflow-y-auto"
      {...pullToRefresh.bind}
    >
      <div
        className="flex items-center justify-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 transition-all"
        style={{ minHeight: `${Math.min(64, Math.max(20, pullToRefresh.pullDistance))}px` }}
      >
        {pullToRefresh.isRefreshing || refreshing ? 'Refreshing route...' : 'Pull to refresh'}
      </div>

      {routes.length > 1 && (
        <label className="block rounded-3xl bg-white p-4 shadow-card">
          <span className="mb-2 block text-sm font-medium text-slate-700">Assigned route</span>
          <select
            value={selectedRouteId || currentRoute?.id || ''}
            onChange={(event) => setSelectedRouteId(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          >
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name || `Route ${route.id.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="rounded-[2rem] bg-ink p-5 text-white shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Today’s route</p>
        <h2 className="mt-2 text-2xl font-semibold">{currentRoute?.name || 'No active route'}</h2>
        <p className="mt-2 text-sm text-white/75">
          {currentRoute?.notes || 'Your route is synced for offline viewing when signal drops.'}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/60">Stops</p>
            <p className="mt-2 text-2xl font-semibold">{currentRoute?.stops.length || 0}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/60">Ready</p>
            <p className="mt-2 text-2xl font-semibold">
              {currentRoute?.stops.filter((stop) => stop.status !== 'failed' && stop.status !== 'completed').length || 0}
            </p>
          </div>
        </div>
      </div>

      {currentRoute?.stops.length ? (
        <div className="space-y-4">
          {currentRoute.stops.map((stop) => (
            <StopCard key={stop.id} stop={stop} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl bg-white p-6 text-sm text-slate-600 shadow-card">
          No route stops are assigned right now.
        </div>
      )}
    </section>
  );
}
