import { useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { sendWithAuth } from '../lib/api';

type AiActionItem = {
  priority: 'CRITICAL' | 'WARNING' | 'INFO';
  action: string;
  product_id: string;
  product_name: string;
  current_stock: number;
  reason: string;
  suggested_action: string;
};
type AiAnalysis = {
  analysis_date: string;
  total_skus_analyzed: number;
  summary: { critical_items: number; warning_items: number; overstocked_items: number; healthy_items: number };
  action_items: AiActionItem[];
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-700 bg-red-50 border-red-200',
  WARNING:  'text-yellow-700 bg-yellow-50 border-yellow-200',
  INFO:     'text-blue-700 bg-blue-50 border-blue-200',
};

/**
 * AI inventory health analysis. Self-contained: owns its own analysis result,
 * loading, and error state plus the POST call, so running it does not
 * re-render the rest of the (very large) inventory page.
 */
export function InventoryAiHealthCard() {
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiRef = useRef<HTMLDivElement>(null);

  async function runAiHealthAnalysis() {
    setAiLoading(true); setAiError(''); setAiAnalysis(null);
    try {
      const data = await sendWithAuth<AiAnalysis>('/api/ai/inventory-analysis', 'POST', {});
      setAiAnalysis(data);
      setTimeout(() => aiRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      setAiError(String((err as Error).message || 'AI analysis failed'));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>AI Inventory Health Analysis</CardTitle>
          <CardDescription>
            Analyzes stock levels, expiring lots, and recent usage patterns to surface critical reorder and spoilage alerts.
          </CardDescription>
        </div>
        <Button onClick={runAiHealthAnalysis} disabled={aiLoading}>
          {aiLoading ? 'Analyzing…' : 'Run AI Analysis'}
        </Button>
      </CardHeader>
      {aiError && (
        <CardContent>
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{aiError}</div>
        </CardContent>
      )}
      {aiAnalysis && (
        <CardContent className="space-y-4" ref={aiRef}>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: 'SKUs Analyzed', value: aiAnalysis.total_skus_analyzed },
              { label: 'Critical', value: aiAnalysis.summary.critical_items },
              { label: 'Warnings', value: aiAnalysis.summary.warning_items },
              { label: 'Healthy', value: aiAnalysis.summary.healthy_items },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="mt-1 text-2xl font-bold">{value}</div>
              </div>
            ))}
          </div>
          {aiAnalysis.action_items.length > 0 ? (
            <div className="space-y-2">
              {aiAnalysis.action_items.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-md border px-4 py-3 text-sm ${PRIORITY_COLORS[item.priority] ?? 'bg-muted border-border'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">[{item.priority}]</span>
                    <span className="font-semibold">{item.product_name}</span>
                    <span className="text-xs text-muted-foreground">#{item.product_id}</span>
                    <span className="ml-auto text-xs">Stock: {item.current_stock.toLocaleString()}</span>
                  </div>
                  <div className="mt-1">{item.reason}</div>
                  <div className="mt-1 font-medium">→ {item.suggested_action}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              All inventory items look healthy — no immediate action required.
            </div>
          )}
          <p className="text-xs text-muted-foreground">Analysis run: {new Date(aiAnalysis.analysis_date).toLocaleString()}</p>
        </CardContent>
      )}
    </Card>
  );
}
