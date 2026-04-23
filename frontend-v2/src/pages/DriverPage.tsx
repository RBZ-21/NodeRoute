import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

interface Stop {
  id: string | number;
  stop_number: number;
  address: string;
  customer_name: string;
  order_number: string;
  status: 'pending' | 'arrived' | 'completed' | 'failed';
  notes?: string;
  failure_note?: string;
}

interface DriverRoute {
  id: string | number;
  name: string;
  status: string;
  stops: Stop[];
}

interface DriverRouteResponse {
  driver_name: string;
  route: DriverRoute | null;
}

const STOP_COLOR_MAP: Record<string, 'yellow' | 'blue' | 'green' | 'red'> = {
  pending: 'yellow',
  arrived: 'blue',
  completed: 'green',
  failed: 'red',
};

const ROUTE_COLOR_MAP: Record<string, 'green' | 'yellow' | 'red' | 'gray'> = {
  active: 'green',
  completed: 'green',
  pending: 'yellow',
  cancelled: 'red',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

interface StopCardProps {
  stop: Stop;
  isSubmitting: boolean;
  isFailingMode: boolean;
  failureNote: string;
  onFailureNoteChange: (v: string) => void;
  onMarkArrived: () => void;
  onMarkComplete: () => void;
  onMarkFailedClick: () => void;
  onConfirmFailed: () => void;
  onCancelFailed: () => void;
}

function StopCard({
  stop,
  isSubmitting,
  isFailingMode,
  failureNote,
  onFailureNoteChange,
  onMarkArrived,
  onMarkComplete,
  onMarkFailedClick,
  onConfirmFailed,
  onCancelFailed,
}: StopCardProps) {
  const isDone = stop.status === 'completed' || stop.status === 'failed';

  return (
    <Card className="border-gray-800 bg-gray-900">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-gray-300">
              {stop.stop_number}
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{stop.address}</p>
              <p className="text-xs text-gray-400">{stop.customer_name}</p>
            </div>
          </div>
          <StatusBadge status={stop.status} colorMap={STOP_COLOR_MAP} />
        </div>

        <div className="mb-3 space-y-1 pl-10">
          <p className="text-xs text-gray-500">
            Order:{' '}
            <span className="text-gray-300">{stop.order_number}</span>
          </p>
          {stop.notes && (
            <p className="text-xs text-gray-500">
              Notes: <span className="text-gray-300">{stop.notes}</span>
            </p>
          )}
          {stop.failure_note && (
            <p className="text-xs text-red-400">Failure: {stop.failure_note}</p>
          )}
        </div>

        {!isDone && !isFailingMode && (
          <div className="flex gap-2 pl-10">
            {stop.status === 'pending' && (
              <Button
                size="sm"
                variant="outline"
                disabled={isSubmitting}
                onClick={onMarkArrived}
                className="h-11 flex-1 border-blue-700 bg-blue-950 text-blue-300 hover:bg-blue-900"
              >
                Arrived
              </Button>
            )}
            {(stop.status === 'pending' || stop.status === 'arrived') && (
              <Button
                size="sm"
                disabled={isSubmitting}
                onClick={onMarkComplete}
                className="h-11 flex-1 bg-green-700 text-white hover:bg-green-600"
              >
                Complete
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={onMarkFailedClick}
              className="h-11 flex-1 border-red-800 bg-red-950 text-red-400 hover:bg-red-900"
            >
              Failed
            </Button>
          </div>
        )}

        {isFailingMode && (
          <div className="mt-2 space-y-2 pl-10">
            <textarea
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-600"
              placeholder="Failure note (optional)"
              rows={2}
              value={failureNote}
              onChange={(e) => onFailureNoteChange(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={isSubmitting}
                onClick={onConfirmFailed}
                className="h-11 flex-1 bg-red-700 text-white hover:bg-red-600"
              >
                Confirm Failed
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCancelFailed}
                className="h-11 flex-1 border-gray-600 text-gray-400 hover:bg-gray-800"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DriverPage() {
  const [driverName, setDriverName] = useState('');
  const [route, setRoute] = useState<DriverRoute | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failingStopId, setFailingStopId] = useState<string | number | null>(null);
  const [failureNote, setFailureNote] = useState('');
  const [submitting, setSubmitting] = useState<string | number | null>(null);

  useEffect(() => {
    fetchWithAuth<DriverRouteResponse>('/api/driver/route')
      .then((data) => {
        setDriverName(data.driver_name || 'Driver');
        setRoute(data.route ?? null);
        setStops(data.route?.stops ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load route');
      })
      .finally(() => setLoading(false));
  }, []);

  const updateStopStatus = useCallback(
    async (stopId: string | number, status: 'arrived' | 'completed' | 'failed', failNote?: string) => {
      setSubmitting(stopId);
      try {
        await sendWithAuth(`/api/stops/${stopId}`, 'PATCH', {
          status,
          ...(failNote ? { failure_note: failNote } : {}),
        });
        setStops((prev) =>
          prev.map((s) =>
            s.id === stopId ? { ...s, status, ...(failNote ? { failure_note: failNote } : {}) } : s
          )
        );
        if (status === 'failed') {
          setFailingStopId(null);
          setFailureNote('');
        }
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setSubmitting(null);
      }
    },
    []
  );

  const handleLogout = () => {
    localStorage.removeItem('nr_token');
    localStorage.removeItem('nr_user');
    window.location.href = '/login';
  };

  const completedCount = stops.filter((s) => s.status === 'completed').length;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <p className="text-lg text-gray-400">Loading your route...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">NodeRoute</p>
            <h1 className="text-lg font-semibold">
              Good {greeting()}, {driverName}
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            Logout
          </Button>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4 pb-8">
        {error && (
          <Card className="border-red-900 bg-red-950">
            <CardContent className="p-4 text-sm text-red-300">{error}</CardContent>
          </Card>
        )}

        {route ? (
          <>
            <Card className="border-gray-800 bg-gray-900">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base text-white">{route.name}</CardTitle>
                  <StatusBadge status={route.status} colorMap={ROUTE_COLOR_MAP} />
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <div className="rounded-lg bg-gray-800 py-3 text-center">
                  <span className="text-3xl font-bold text-green-400">{completedCount}</span>
                  <span className="text-gray-400"> / {stops.length} stops completed</span>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {stops.map((stop) => (
                <StopCard
                  key={stop.id}
                  stop={stop}
                  isSubmitting={submitting === stop.id}
                  isFailingMode={failingStopId === stop.id}
                  failureNote={failingStopId === stop.id ? failureNote : ''}
                  onFailureNoteChange={setFailureNote}
                  onMarkArrived={() => updateStopStatus(stop.id, 'arrived')}
                  onMarkComplete={() => updateStopStatus(stop.id, 'completed')}
                  onMarkFailedClick={() => {
                    setFailingStopId(stop.id);
                    setFailureNote('');
                  }}
                  onConfirmFailed={() => updateStopStatus(stop.id, 'failed', failureNote || undefined)}
                  onCancelFailed={() => {
                    setFailingStopId(null);
                    setFailureNote('');
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-8 text-center">
              <h2 className="mb-1 text-lg font-semibold text-white">No route assigned for today</h2>
              <p className="text-sm text-gray-400">Check with your dispatcher.</p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
