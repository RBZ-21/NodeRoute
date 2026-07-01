import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { TableCell, TableRow } from './table';

type LoadingSkeletonProps = {
  rows?: number;
  label?: string;
  className?: string;
};

export function LoadingSkeleton({ rows = 3, label = 'Loading data', className }: LoadingSkeletonProps) {
  const widths = ['85%', '64%', '74%', '52%'];
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('rounded-md border border-border bg-muted/20 p-4', className)}
    >
      <div className="animate-pulse space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="h-4 rounded bg-muted"
            style={{ width: widths[index % widths.length], opacity: 1 - index * 0.08 }}
          />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

type TableLoadingRowProps = {
  colSpan: number;
  label?: string;
  rows?: number;
};

export function TableLoadingRow({ colSpan, label, rows }: TableLoadingRowProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-4">
        <LoadingSkeleton rows={rows} label={label} />
      </TableCell>
    </TableRow>
  );
}

type TableEmptyStateProps = {
  colSpan: number;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
};

export function TableEmptyState({ colSpan, title, description, actionLabel, onAction, children }: TableEmptyStateProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <div className="space-y-2 py-6 text-center">
          <div className="font-medium text-foreground">{title}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
          {actionLabel && onAction ? <Button size="sm" onClick={onAction}>{actionLabel}</Button> : null}
          {children}
        </div>
      </TableCell>
    </TableRow>
  );
}
