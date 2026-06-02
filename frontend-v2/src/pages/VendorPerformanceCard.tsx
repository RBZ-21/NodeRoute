import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useVendorPerformance } from '../hooks/useAI';

/**
 * AI-scored vendor reliability scorecard. Self-contained: owns its own
 * "scoring enabled" toggle and query so toggling/refreshing it does not
 * re-render the rest of the purchasing page.
 */
export function VendorPerformanceCard() {
  const [enabled, setEnabled] = useState(false);
  const vendorPerfQuery = useVendorPerformance(enabled);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>✦ Vendor Performance Scorecard</CardTitle>
          <CardDescription>
            {vendorPerfQuery.data?.summary || 'AI-scored vendor reliability based on order history, short-ships, and lead times.'}
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!enabled) {
              setEnabled(true);
            } else {
              void vendorPerfQuery.refetch();
            }
          }}
          disabled={vendorPerfQuery.isFetching}
        >
          {vendorPerfQuery.isFetching ? 'Scoring…' : vendorPerfQuery.data ? 'Refresh' : 'Score Vendors'}
        </Button>
      </CardHeader>
      {vendorPerfQuery.isError && (
        <CardContent>
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {String((vendorPerfQuery.error as Error)?.message || 'Vendor scoring failed')}
          </div>
        </CardContent>
      )}
      {vendorPerfQuery.data && (
        <CardContent>
          {vendorPerfQuery.data.scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendor data available to score. Confirm purchase orders to build vendor history.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {vendorPerfQuery.data.scores.map((v, i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm truncate pr-2">{v.vendor}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold border ${
                      v.grade === 'A' ? 'bg-green-100 border-green-300 text-green-800'
                      : v.grade === 'B' ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : v.grade === 'C' ? 'bg-yellow-100 border-yellow-300 text-yellow-800'
                      : 'bg-red-100 border-red-300 text-red-800'
                    }`}>{v.grade}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Score: {v.score}/100</div>
                  {v.strengths.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 mb-0.5">Strengths</p>
                      <ul className="text-xs text-emerald-700 space-y-0.5">
                        {v.strengths.map((s, j) => <li key={j}>✓ {s}</li>)}
                      </ul>
                    </div>
                  )}
                  {v.risks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-700 mb-0.5">Risks</p>
                      <ul className="text-xs text-red-700 space-y-0.5">
                        {v.risks.map((r, j) => <li key={j}>⚠ {r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
