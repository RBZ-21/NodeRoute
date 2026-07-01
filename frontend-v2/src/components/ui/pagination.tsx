import { Button } from './button';
import { SelectInput } from './select-input';
import { cn } from '../../lib/utils';

type PaginationControlsProps = {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  itemCount: number;
  pageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
};

export function PaginationControls({
  page,
  pageCount,
  setPage,
  itemCount,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  className,
}: PaginationControlsProps) {
  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);
  const from = itemCount === 0 || !pageSize ? 0 : (safePage - 1) * pageSize + 1;
  const to = itemCount === 0 || !pageSize ? 0 : Math.min(itemCount, safePage * pageSize);

  return (
    <div className={cn('flex flex-col gap-2 border-t border-border bg-muted/10 px-2 py-2 text-sm sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="text-xs text-muted-foreground">
        {pageSize ? `Showing ${from}-${to} of ${itemCount.toLocaleString()}` : `${itemCount.toLocaleString()} rows`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && pageSize ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Rows per page
            <SelectInput
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-8 w-20 px-2"
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </SelectInput>
          </label>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(safePage - 1)}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <span className="min-w-[88px] text-center text-xs font-medium text-muted-foreground">
          Page {safePage} of {safePageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(safePage + 1)}
          disabled={safePage >= safePageCount}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
