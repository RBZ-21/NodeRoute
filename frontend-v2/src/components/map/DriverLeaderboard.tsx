import { useMemo } from 'react';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../../lib/utils';
import { useAnalyticsQuery, useDriversQuery } from '../../hooks/useDashboard';

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function DriverLeaderboard({ enabled = true }: { enabled?: boolean }) {
  const analyticsQuery = useAnalyticsQuery(enabled);
  const driversQuery = useDriversQuery(enabled);

  const analytics = analyticsQuery.data ?? null;
  const drivers = useMemo(() => driversQuery.data ?? [], [driversQuery.data]);

  const topDrivers = useMemo(() => {
    const ranked = analytics?.driverRankings?.length
      ? analytics.driverRankings
      : drivers.map((d) => ({
          name: d.name,
          stopsPerHour: Number((asNumber(d.totalStopsToday, 0) / 8).toFixed(1)),
          avgStopMinutes: asNumber(d.avgStopMinutes, 0),
          avgSpeedMph: asNumber(d.avgSpeedMph, 0),
          onTimeRate: asNumber(d.onTimeRate, 0),
          milesToday: asNumber(d.milesToday, 0),
        }));
    return [...ranked].sort((a, b) => b.onTimeRate - a.onTimeRate || b.stopsPerHour - a.stopsPerHour).slice(0, 5);
  }, [analytics, drivers]);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm">Driver Leaderboard</CardTitle>
        <CardDescription>Best performers today based on on-time rate and stops per hour.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-4 space-y-3">
        {topDrivers.length ? (
          topDrivers.map((driver, index) => (
            <div key={driver.name} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">#{index + 1} {driver.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{driver.stopsPerHour.toFixed(1)} stops/hr · {driver.avgSpeedMph.toFixed(1)} mph · {driver.avgStopMinutes.toFixed(1)} min avg stop</div>
                </div>
                <Badge variant={driver.onTimeRate >= 90 ? 'success' : driver.onTimeRate >= 75 ? 'warning' : 'neutral'}>{driver.onTimeRate.toFixed(1)}%</Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full', driver.onTimeRate >= 90 ? 'bg-emerald-500' : driver.onTimeRate >= 75 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${Math.max(6, Math.min(100, driver.onTimeRate))}%` }} />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
            <div className="font-semibold text-foreground">No driver performance yet</div>
            <div className="mt-1">Driver rankings will populate after routes begin logging activity.</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
