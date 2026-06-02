import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useReorderAlerts } from '../hooks/useAI';

/**
 * AI reorder alerts. Self-contained: owns its own "analysis enabled" toggle
 * and query, so running/refreshing it does not re-render the rest of the
 * (very large) inventory page.
 */
export function SmartReorderAlertsCard() {
  const [enabled, setEnabled] = useState(false);
  const reorderAlertsQuery = useReorderAlerts(enabled);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>✦ Smart Reorder Alerts</CardTitle>
          <CardDescription>
            {reorderAlertsQuery.data?.summary || 'AI-powered alerts for items approaching stockout based on recent sales velocity.'}
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!enabled) {
              setEnabled(true);
            } else {
              void reorderAlertsQuery.refetch();
            }
          }}
          disabled={reorderAlertsQuery.isFetching}
        >
          {reorderAlertsQuery.isFetching ? 'Analyzing…' : reorderAlertsQuery.data ? 'Refresh' : 'Run Reorder Analysis'}
        </Button>
      </CardHeader>
      {reorderAlertsQuery.isError && (
        <CardContent>
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {String((reorderAlertsQuery.error as Error)?.message || 'Reorder analysis failed')}
          </div>
        </CardContent>
      )}
      {reorderAlertsQuery.data && (
        <CardContent>
          {reorderAlertsQuery.data.alerts.length === 0 ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              All items have sufficient stock — no reorder alerts at this time.
            </div>
          ) : (
            <div className="space-y-2">
              {reorderAlertsQuery.data.alerts.map((alert, i) => (
                <div
                  key={i}
                  className={`rounded-md border px-4 py-3 text-sm ${
                    alert.urgency === 'CRITICAL'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : alert.urgency === 'WARNING'
                      ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                      : 'border-blue-200 bg-blue-50 text-blue-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border px-2 py-0.5 text-xs font-bold">{alert.urgency}</span>
                      <span className="font-semibold">{alert.description}</span>
                      <span className="text-xs opacity-70">#{alert.item_number}</span>
                    </div>
                    <span className="text-xs font-medium">{alert.days_until_stockout}d until stockout</span>
                  </div>
                  <p className="mt-1">{alert.reason}</p>
                  <p className="mt-1 font-medium">→ Order {alert.suggested_order_qty.toLocaleString()} {alert.unit}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
