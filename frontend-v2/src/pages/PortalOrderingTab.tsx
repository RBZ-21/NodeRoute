import { useEffect, useMemo, useState } from 'react';
import { Lock, ShoppingCart, RotateCcw } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { LoadingSkeleton } from '../components/ui/data-state';
import { useToast } from '../components/ui/toast';
import { fetchPortalList, fetchWithPortalAuth, sendWithPortalAuth } from '../lib/portalApi';
import { formatMoney } from './portal.types';
import type { PortalCatalogItem, PortalOrder } from './portal.types';

/**
 * Online Ordering tab for the customer portal (paid add-on).
 *
 * When the company has not purchased the add-on, the API reports
 * { enabled: false } and we render a tasteful locked card. When enabled, the
 * customer can browse the live catalog, build a cart, submit a pending order,
 * and one-tap reorder from a past order. No delivery-window selection anywhere.
 */
export function PortalOrderingTab({ pastOrders, onSubmitted }: { pastOrders: PortalOrder[]; onSubmitted: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<PortalCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);      try {
        const status = await fetchWithPortalAuth<{ enabled: boolean }>('/api/portal/ordering-status');
        if (cancelled) return;
        setEnabled(status.enabled);
        if (status.enabled) {
          const items = await fetchPortalList<PortalCatalogItem>('/api/portal/catalog');
          if (!cancelled) setCatalog(items);
        }
      } catch (err) {
        if (!cancelled) toast.error(String((err as Error).message || 'Could not load online ordering.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((item) =>
      String(item.name || '').toLowerCase().includes(needle) ||
      String(item.item_number || '').toLowerCase().includes(needle) ||
      String(item.category || '').toLowerCase().includes(needle));
  }, [catalog, search]);

  const cartLines = useMemo(
    () => catalog.filter((item) => (cart[item.id] || 0) > 0),
    [catalog, cart],
  );
  const cartTotal = cartLines.reduce((sum, item) => sum + (item.price || 0) * (cart[item.id] || 0), 0);

  function setQty(id: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id]; else next[id] = qty;
      return next;
    });
  }

  async function submitCart() {
    if (!cartLines.length) return;
    setSubmitting(true);
    try {
      const items = cartLines.map((item) => ({ product_id: item.id, item_number: item.item_number, quantity: cart[item.id] }));
      const result = await sendWithPortalAuth<{ order_number: string }>('/api/portal/orders/submit', 'POST', { items });
      setCart({});
      toast.success(`Order ${result.order_number} submitted. Your distributor will confirm shortly.`);
      onSubmitted();
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not submit order.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function reorder(orderId: string) {
    setSubmitting(true);
    try {
      const result = await sendWithPortalAuth<{ order_number: string; skipped?: string[] }>(`/api/portal/orders/${orderId}/reorder`, 'POST');
      const skippedNote = result.skipped?.length ? ` (unavailable items skipped: ${result.skipped.join(', ')})` : '';
      toast.success(`Reorder ${result.order_number} submitted.${skippedNote}`);
      onSubmitted();
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not reorder.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <LoadingSkeleton rows={4} label="Loading online ordering" />
        </CardContent>
      </Card>
    );
  }

  // ── Locked upsell card (add-on not purchased) ──────────────────────────────
  if (enabled === false) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="rounded-full bg-muted p-3">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Online Ordering</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Place orders directly from your distributor's live catalog, with your pricing and
            one-tap reordering from past orders. Ask your distributor about enabling online ordering
            for your account.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">

      {/* Reorder from past orders */}
      {pastOrders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reorder</CardTitle>
            <CardDescription>One tap to recreate a previous order from current catalog pricing.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {pastOrders.slice(0, 6).map((order) => (
              <Button key={order.id} size="sm" variant="outline" disabled={submitting} onClick={() => void reorder(order.id)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {order.order_number || order.id.slice(0, 8)}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">Catalog</CardTitle>
            <CardDescription>In-stock items from your distributor. Out-of-stock items cannot be added.</CardDescription>
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" aria-label="Search catalog items" className="w-full md:w-64" />
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No catalog items match your search.</p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((item) => {
                const qty = cart[item.id] || 0;
                return (
                  <div key={item.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        {item.stock_state === 'limited' && <Badge variant="warning" className="text-[10px]">Limited</Badge>}
                        {item.stock_state === 'out_of_stock' && <Badge variant="secondary" className="text-[10px]">Out of stock</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.item_number ? `#${item.item_number} · ` : ''}{formatMoney(item.price)} / {item.unit}
                      </div>
                    </div>
                    {item.addable ? (
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setQty(item.id, qty - 1)} disabled={qty <= 0}>−</Button>
                        <span className="w-8 text-center text-sm tabular-nums">{qty}</span>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setQty(item.id, qty + 1)}>+</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unavailable</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cart summary / submit */}
      {cartLines.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-4 w-4" />Your Cart ({cartLines.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cartLines.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span>{cart[item.id]} × {item.name}</span>
                <span className="tabular-nums">{formatMoney((item.price || 0) * (cart[item.id] || 0))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
              <span>Estimated total</span>
              <span className="tabular-nums">{formatMoney(cartTotal)}</span>
            </div>
            <Button className="w-full" disabled={submitting} onClick={() => void submitCart()}>
              {submitting ? 'Submitting…' : 'Submit Order'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Final pricing and availability are confirmed by your distributor.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
