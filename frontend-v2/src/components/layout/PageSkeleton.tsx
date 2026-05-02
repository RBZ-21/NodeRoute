/**
 * Generic page-level skeleton loader.
 * Shown via <Suspense fallback> while a lazy page chunk loads.
 * Mimics a typical data page: KPI row → filter bar → table.
 */
export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label="Loading page">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-muted h-24" />
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex gap-3">
        <div className="h-9 w-48 rounded-md bg-muted" />
        <div className="h-9 w-32 rounded-md bg-muted" />
        <div className="ml-auto h-9 w-24 rounded-md bg-muted" />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex gap-4 bg-muted/60 px-4 py-3">
          {[40, 20, 20, 20].map((w, i) => (
            <div key={i} className="h-4 rounded bg-muted" style={{ width: `${w}%` }} />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, row) => (
          <div key={row} className="flex gap-4 border-t border-border px-4 py-3">
            {[40, 20, 20, 20].map((w, col) => (
              <div
                key={col}
                className="h-4 rounded bg-muted"
                style={{ width: `${w}%`, opacity: 1 - row * 0.1 }}
              />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
