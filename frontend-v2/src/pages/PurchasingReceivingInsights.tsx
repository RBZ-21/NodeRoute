import { memo } from 'react';
import { type LeadTimeInsights, type ReceiptDiscrepancyEntry, formatLeadTimeDays } from './purchasing.helpers';

export type DiscrepancyLog = {
  entries: ReceiptDiscrepancyEntry[];
  receiptsWithVariance: number;
  shortQty: number;
  overQty: number;
};

type Props = {
  leadTimeInsights: LeadTimeInsights;
  discrepancyLog: DiscrepancyLog;
};

/**
 * Read-only receiving insight panels (lead-time KPIs + discrepancy log).
 * Memoized so editing the receive drawer below (carrier, notes, quantities)
 * does not re-render these panels — their inputs are already memoized in the
 * parent, so memo() lets them skip work on unrelated state changes.
 */
function PurchasingReceivingInsightsImpl({ leadTimeInsights, discrepancyLog }: Props) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-muted/10 p-4">
          <div className="text-sm font-semibold text-foreground">Historical Lead Time</div>
          <div className="mt-2 text-2xl font-semibold">{leadTimeInsights.measuredCount ? formatLeadTimeDays(leadTimeInsights.averageDays) : 'No history yet'}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Average first-receipt lead time across {leadTimeInsights.measuredCount} received PO{leadTimeInsights.measuredCount === 1 ? '' : 's'}.
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/10 p-4">
          <div className="text-sm font-semibold text-foreground">Median Lead Time</div>
          <div className="mt-2 text-2xl font-semibold">{leadTimeInsights.measuredCount ? formatLeadTimeDays(leadTimeInsights.medianDays) : 'No history yet'}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Measured across {leadTimeInsights.vendorCount} vendor relationship{leadTimeInsights.vendorCount === 1 ? '' : 's'}.
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/10 p-4">
          <div className="text-sm font-semibold text-foreground">Most Recent Lead Time</div>
          <div className="mt-2 text-2xl font-semibold">{formatLeadTimeDays(leadTimeInsights.latestDays)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Based on the latest PO that recorded a first receipt timestamp.
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Discrepancy Log</div>
            <div className="text-xs text-muted-foreground">
              Recent overages and short receipts across vendor PO receiving.
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              Receipts w/ variance: <strong>{discrepancyLog.receiptsWithVariance}</strong>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              Short qty flagged: <strong>{discrepancyLog.shortQty.toFixed(2)}</strong>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              Over qty flagged: <strong>{discrepancyLog.overQty.toFixed(2)}</strong>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
          <div className="text-sm font-semibold text-foreground">Recent Discrepancy Activity</div>
          {discrepancyLog.entries.length ? (
            <div className="space-y-2">
              {discrepancyLog.entries.slice(0, 6).map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong>{entry.poNumber}</strong> · {entry.vendor}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.receivedAt ? new Date(entry.receivedAt).toLocaleString() : 'Receipt logged'}
                    </div>
                  </div>
                  <div className="mt-1">
                    {entry.lineLabel}: <span className="capitalize">{entry.varianceLabel}</span>
                    {entry.quantityVariance !== 0 ? ` (${entry.quantityVariance.toFixed(2)})` : ''}
                    {entry.overReceiptQty > 0 ? ` · over by ${entry.overReceiptQty.toFixed(2)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground">
              No receipt discrepancies have been logged yet. When vendors short or over-ship items, the variance history will show up here.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const PurchasingReceivingInsights = memo(PurchasingReceivingInsightsImpl);
