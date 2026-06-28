import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import type { InventoryItem } from '../types/inventory.types';
import { useAdjustMutation, useRestockMutation } from '../hooks/useInventory';
import { asNumber, inventoryActionLabel } from './inventory.helpers';

/**
 * Restock / adjustment actions against a selected inventory SKU. Self-contained:
 * owns the item selection, quantity inputs, inline feedback, and submit state
 * plus its own restock/adjust mutations, so posting an action does not
 * re-render the rest of the (very large) inventory page. TanStack dedupes the
 * mutation hooks by key, so calling them here is free.
 */
export function InventoryActionsCard({
  items,
  fixRequest,
}: {
  items: InventoryItem[];
  /** Set by "Fix" buttons next to negative stock readings: pre-selects the SKU
   *  and pre-fills the adjustment delta needed to bring it back to zero. */
  fixRequest?: { itemId: string; nonce: number } | null;
}) {
  const restockMutation = useRestockMutation();
  const adjustMutation = useAdjustMutation();
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [restockQty, setRestockQty] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;

  // Pre-select the first item once inventory loads. Use the first item whose
  // id is truthy so we never silently pre-select a blank value.
  const selectorInitialized = useRef(false);
  useEffect(() => {
    if (selectorInitialized.current || !items.length) return;
    selectorInitialized.current = true;
    setSelectedItemId(items[0]?.id || '');
  }, [items]);

  // Honour incoming "Fix" requests from negative-stock indicators. This must
  // fire only when a new request arrives (keyed by nonce), reading the latest
  // items/fixRequest via refs so an inventory refetch does not re-scroll.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const fixRequestRef = useRef(fixRequest);
  fixRequestRef.current = fixRequest;
  useEffect(() => {
    const request = fixRequestRef.current;
    if (!request) return;
    const item = itemsRef.current.find((i) => i.id === request.itemId);
    if (!item) return;
    setSelectedItemId(item.id);
    const qty = asNumber(item.on_hand_qty);
    if (qty < 0) {
      setAdjustDelta(String(-qty));
      setActionNotes('Negative stock correction');
    }
    setActionError('');
    setActionNotice('');
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [fixRequest, items]);

  function clearActionFeedback() { setActionError(''); setActionNotice(''); }

  function requireItemNumber(item: InventoryItem | null, actionLabel: string) {
    if (!item) {
      setActionError(`Please select an item before ${actionLabel}.`);
      return null;
    }
    const itemNumber = String(item.item_number || '').trim();
    if (!itemNumber) {
      setActionError(`"${inventoryActionLabel(item)}" is missing an item number, so ${actionLabel} cannot be posted yet.`);
      return null;
    }
    return itemNumber;
  }

  async function submitRestock() {
    clearActionFeedback();
    const itemNumber = requireItemNumber(selectedItem, 'restocking');
    if (!itemNumber) return;
    const qty = asNumber(restockQty);
    if (qty <= 0) { setActionError('Restock quantity must be greater than 0.'); return; }
    setSubmitting(true);
    try {
      await restockMutation.mutateAsync({ itemNumber, qty, notes: actionNotes || undefined });
      setRestockQty(''); setActionNotes('');
      setActionNotice(`Restocked ${inventoryActionLabel(selectedItem)} by ${qty.toLocaleString()}.`);
    } catch (err) { setActionError(String((err as Error).message || 'Restock failed')); }
    finally { setSubmitting(false); }
  }

  async function submitAdjustment() {
    clearActionFeedback();
    const itemNumber = requireItemNumber(selectedItem, 'applying an adjustment');
    if (!itemNumber) return;
    const delta = asNumber(adjustDelta);
    if (delta === 0) { setActionError('Adjustment delta must be non-zero.'); return; }
    setSubmitting(true);
    try {
      await adjustMutation.mutateAsync({ itemNumber, delta, notes: actionNotes || undefined });
      setAdjustDelta(''); setActionNotes('');
      setActionNotice(`Adjusted ${inventoryActionLabel(selectedItem)} by ${delta > 0 ? '+' : ''}${delta.toLocaleString()}.`);
    } catch (err) { setActionError(String((err as Error).message || 'Adjustment failed')); }
    finally { setSubmitting(false); }
  }

  return (
    <Card ref={cardRef}>
      <CardHeader><CardTitle>Inventory Actions</CardTitle><CardDescription>Select by item name, then post restocks and adjustments against the matching inventory SKU.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        {/* Inline feedback — shown right here in the card, not at the top of the page */}
        {actionError && (
          <div className="md:col-span-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {actionError}
          </div>
        )}
        {actionNotice && (
          <div className="md:col-span-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {actionNotice}
          </div>
        )}
        <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Item</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={selectedItemId}
            onChange={(e) => { setSelectedItemId(e.target.value); clearActionFeedback(); }}
          >
            <option value="">Select item...</option>{items.map((i) => <option key={i.id} value={i.id}>{inventoryActionLabel(i)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Restock Qty</span><Input type="number" min="0" step="0.01" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} placeholder="e.g. 25" /></label>
        <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Adjustment Delta</span><Input type="number" step="0.01" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} placeholder="e.g. -2.5" /></label>
        <label className="space-y-1 text-sm md:col-span-4"><span className="font-semibold text-muted-foreground">Notes</span><Input value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} placeholder="Optional movement notes" /></label>
        <div className="md:col-span-4 flex flex-wrap gap-2">
          <Button onClick={submitRestock} disabled={submitting}>Restock Item</Button>
          <Button variant="secondary" onClick={submitAdjustment} disabled={submitting}>Apply Adjustment</Button>
          {selectedItem && <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">Current: <strong>{asNumber(selectedItem.on_hand_qty).toLocaleString()}</strong> {selectedItem.unit || ''}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
