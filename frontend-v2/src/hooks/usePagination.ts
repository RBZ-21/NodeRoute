import { useCallback, useEffect, useMemo, useState } from 'react';

function clampPage(page: number, pageCount: number) {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), pageCount);
}

export function usePagination<T>(items: T[], pageSize: number) {
  const safePageSize = Math.max(1, Math.trunc(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const [pageState, setPageState] = useState(1);
  const page = clampPage(pageState, pageCount);

  useEffect(() => {
    setPageState(1);
  }, [items, safePageSize]);

  const setPage = useCallback((nextPage: number) => {
    setPageState(clampPage(nextPage, pageCount));
  }, [pageCount]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * safePageSize;
    return items.slice(start, start + safePageSize);
  }, [items, page, safePageSize]);

  return {
    pageItems,
    page,
    pageCount,
    setPage,
    pageSize: safePageSize,
    itemCount: items.length,
  };
}
