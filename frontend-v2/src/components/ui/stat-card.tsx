import { cn } from '../../lib/utils';
import { Card, CardDescription, CardHeader, CardTitle } from './card';

/**
 * StatCard — the standard KPI tile used across dashboards (label + large value).
 * Replaces the per-page `SummaryCard`/`StatCard` copies.
 *
 * `valueClassName` overrides the value styling (e.g. a status colour, or a
 * smaller `text-base` for compact rows); it is merged after the default
 * `text-2xl`, so passing `text-base` wins via tailwind-merge.
 */
export function StatCard({
  label,
  value,
  valueClassName,
  className,
}: {
  label: string;
  value: string | number;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn('text-2xl', valueClassName)}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
