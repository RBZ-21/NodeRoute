import { StopCard } from '@/components/StopCard';
import { useDriverApp } from '@/hooks/useDriverApp';

export function StopsPage() {
  const { currentRoute } = useDriverApp();

  return (
    <section className="space-y-4">
      <div className="rounded-3xl bg-white p-4 shadow-card">
        <p className="text-sm text-slate-600">
          Tap any stop for customer details, order items, proof-of-delivery capture, and status actions.
        </p>
      </div>
      {currentRoute?.stops.length ? (
        currentRoute.stops.map((stop) => <StopCard key={stop.id} stop={stop} />)
      ) : (
        <div className="rounded-3xl bg-white p-6 text-sm text-slate-600 shadow-card">
          No stops are available for this route.
        </div>
      )}
    </section>
  );
}
