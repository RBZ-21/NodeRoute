import { Sparkles } from 'lucide-react';
import { useAiInsights, useAcknowledgeInsight, type AiInsightType } from '../../hooks/useAiInsights';

const TYPE_LABELS: Record<AiInsightType, string> = {
  anomaly: 'Operational anomalies detected',
  reorder: 'Items need reordering soon',
  collections: 'Customers at collections risk',
};

const SEVERITY_CLASSES: Record<string, string> = {
  critical: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  high:     'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  medium:   'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  low:      'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
  info:     'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
};

/**
 * Inline alert banner for proactive AI insights, shown at the top of the
 * Dashboard / Inventory / Invoices pages. Pass the insight types relevant to
 * the page; each banner carries an Acknowledge action.
 */
export function AiInsightBanner({ types }: { types: AiInsightType[] }) {
  const insightsQuery = useAiInsights();
  const acknowledge = useAcknowledgeInsight();

  const insights = (insightsQuery.data ?? []).filter((i) => types.includes(i.type));
  if (!insights.length) return null;

  return (
    <div className="space-y-2">
      {insights.map((insight) => (
        <div
          key={insight.id}
          className={`flex flex-wrap items-center gap-3 rounded-md border px-4 py-2.5 text-sm ${SEVERITY_CLASSES[insight.severity] || SEVERITY_CLASSES.info}`}
          role="alert"
        >
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">
              {TYPE_LABELS[insight.type]}
              {typeof insight.payload?.count === 'number' ? ` (${insight.payload.count})` : ''}
            </span>
            {insight.payload?.summary ? <span className="ml-2">{insight.payload.summary}</span> : null}
            <span className="ml-2 text-xs opacity-70">
              {new Date(insight.created_at).toLocaleString()}
            </span>
          </div>
          <button
            type="button"
            onClick={() => acknowledge.mutate(insight.id)}
            disabled={acknowledge.isPending}
            className="shrink-0 rounded-md border border-current/30 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
          >
            Acknowledge
          </button>
        </div>
      ))}
    </div>
  );
}
