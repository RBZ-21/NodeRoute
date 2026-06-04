import { memo } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import type { OptimizeResult } from '../hooks/useRoutes';

type Props = {
  result: OptimizeResult;
  applying: boolean;
  onApply: () => void;
  onDismiss: () => void;
};

/**
 * AI route-optimization result. Presentational + memoized: the parent owns the
 * optimize mutation and result state and passes them down, so this card only
 * re-renders when the result or pending flag actually changes — not on every
 * keystroke elsewhere on the routes page.
 */
function RouteOptimizationResultCardImpl({ result, applying, onApply, onDismiss }: Props) {
  return (
    <Card className="border-primary/40 ring-1 ring-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">❆ Optimized Stop Order</CardTitle>
        <CardDescription>Estimated efficiency gain: {result.estimated_efficiency_gain}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{result.reasoning}</p>
        {result.key_changes.length > 0 && (
          <ul className="space-y-1">
            {result.key_changes.map((change, i) => (
              <li key={i} className="flex items-start gap-2 text-sm"><span className="mt-0.5 text-primary">•</span>{change}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={onApply} disabled={applying}>Apply New Order</Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export const RouteOptimizationResultCard = memo(RouteOptimizationResultCardImpl);
