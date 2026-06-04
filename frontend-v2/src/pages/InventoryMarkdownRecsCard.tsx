import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { sendWithAuth } from '../lib/api';

type MarkdownRec = {
  product_id: string;
  product_name: string;
  lot_number: string | null;
  days_until_expiry: number;
  current_stock: number;
  suggested_discount_pct: number;
  urgency: string;
  message: string;
  suggested_action: string;
};

/**
 * AI spoilage markdown recommendations. Self-contained: owns its own
 * recommendations, summary, loading, and error state plus the POST call, so
 * running it does not re-render the rest of the (very large) inventory page.
 */
export function InventoryMarkdownRecsCard() {
  const [markdownRecs, setMarkdownRecs] = useState<MarkdownRec[] | null>(null);
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownSummary, setMarkdownSummary] = useState('');
  const [markdownError, setMarkdownError] = useState('');

  async function runMarkdownRecommendations() {
    setMarkdownLoading(true); setMarkdownError('');
    try {
      type MarkdownResult = { recommendations: MarkdownRec[]; summary: string };
      const result = await sendWithAuth<MarkdownResult>('/api/ai/markdown-recommendations', 'POST', { window_days: 10 });
      setMarkdownRecs(result.recommendations || []);
      setMarkdownSummary(result.summary || '');
    } catch (err) { setMarkdownError(String((err as Error).message || 'Markdown recommendations failed')); }
    finally { setMarkdownLoading(false); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">✦ AI Spoilage Markdown Recommendations</CardTitle>
          <CardDescription>{markdownSummary || 'Identify expiring lots and get AI-suggested discount pricing to move product before it spoils.'}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => void runMarkdownRecommendations()} disabled={markdownLoading}>
          {markdownLoading ? 'Analyzing…' : markdownRecs ? 'Re-run' : 'Get Recommendations'}
        </Button>
      </CardHeader>
      {markdownError && (
        <CardContent>
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{markdownError}</div>
        </CardContent>
      )}
      {markdownRecs && (
        <CardContent>
          {markdownRecs.length === 0 ? (
            <p className="text-sm text-emerald-600">No lots approaching expiry within the next 10 days.</p>
          ) : (
            <div className="space-y-2">
              {markdownRecs.map((rec, i) => (
                <div key={i} className={`rounded-lg border px-4 py-3 ${rec.urgency === 'immediate' ? 'border-red-200 bg-red-50' : rec.urgency === 'soon' ? 'border-yellow-200 bg-yellow-50' : 'border-border bg-muted/20'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${rec.urgency === 'immediate' ? 'bg-red-100 text-red-700' : rec.urgency === 'soon' ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground'}`}>{rec.urgency}</span>
                      <span className="font-medium text-sm">{rec.product_name}</span>
                      {rec.lot_number && <span className="ml-2 text-xs text-muted-foreground">Lot: {rec.lot_number}</span>}
                      <div className="mt-1 text-xs text-muted-foreground">{rec.days_until_expiry}d left · {rec.current_stock} units on hand</div>
                    </div>
                    <div className="rounded-lg bg-background border border-border px-3 py-2 text-center">
                      <div className="text-xl font-bold text-primary">{rec.suggested_discount_pct}%</div>
                      <div className="text-xs text-muted-foreground">off</div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs italic text-muted-foreground">"{rec.message}"</p>
                  <p className="mt-1 text-xs font-medium">→ {rec.suggested_action}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
