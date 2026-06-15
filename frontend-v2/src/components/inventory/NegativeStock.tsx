import { AlertTriangle } from 'lucide-react';

export const NEGATIVE_STOCK_TOOLTIP = 'Negative stock — needs adjustment';

/**
 * Error-state rendering for a negative on-hand quantity: red text, warning
 * icon with tooltip, and an optional "Fix" action that jumps into the
 * Inventory Actions adjustment flow pre-filled with the SKU.
 */
export function NegativeStockQty({
  qty,
  unit,
  onFix,
}: {
  qty: number;
  unit?: string;
  onFix?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400" title={NEGATIVE_STOCK_TOOLTIP}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-label={NEGATIVE_STOCK_TOOLTIP} />
      {qty.toLocaleString()} {unit || ''}
      {onFix ? (
        <button
          type="button"
          onClick={onFix}
          className="ml-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50"
        >
          Fix
        </button>
      ) : null}
    </span>
  );
}
