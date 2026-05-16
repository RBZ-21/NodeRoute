import { useRef, useState } from 'react';

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startYRef = useRef(0);
  const touchingRef = useRef(false);

  function onTouchStart(event: React.TouchEvent<HTMLElement>) {
    if (event.currentTarget.scrollTop > 0) return;
    touchingRef.current = true;
    startYRef.current = event.touches[0]?.clientY || 0;
  }

  function onTouchMove(event: React.TouchEvent<HTMLElement>) {
    if (!touchingRef.current) return;
    const currentY = event.touches[0]?.clientY || 0;
    const nextDistance = Math.max(0, Math.min(120, currentY - startYRef.current));
    setPullDistance(nextDistance);
  }

  async function onTouchEnd() {
    if (!touchingRef.current) return;
    touchingRef.current = false;
    const shouldRefresh = pullDistance > 70;
    setPullDistance(0);
    if (!shouldRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }

  return {
    isRefreshing,
    pullDistance,
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
