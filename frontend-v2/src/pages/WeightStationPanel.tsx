import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { asNumber, orderItemQty } from './orders.types';
import type { Order, OrderItem } from './orders.types';

function isWeightItem(item: OrderItem) {
  return (
    item.is_catch_weight ||
    String(item.unit || '').toLowerCase() === 'lb' ||
    item.requested_weight !== undefined
  );
}

function pendingWeightCount(order: Order) {
  return (order.items || []).filter(isWeightItem).filter((i) => !asNumber(i.actual_weight)).length;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

type Props = {
  orders: Order[];
  weightInputs: Record<string, string>;
  savingWeight: Record<string, boolean>;
  onWeightInputChange: (key: string, val: string) => void;
  onSaveWeight: (orderId: string, itemIndex: number) => Promise<void>;
};

export function WeightStationPanel({
  orders,
  weightInputs,
  savingWeight,
  onWeightInputChange,
  onSaveWeight,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeItemIdx, setActiveItemIdx] = useState<number | null>(null);
  const weightInputRef = useRef<HTMLInputElement>(null);

  const activeOrders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return orders
      .filter((o) => {
        const s = String(o.status || '').toLowerCase();
        return s === 'pending' || s === 'in_process';
      })
      .filter((o) => {
        if (!q) return true;
        return (
          (o.customer_name || '').toLowerCase().includes(q) ||
          (o.order_number || '').toLowerCase().includes(q) ||
          (o.customer_address || '').toLowerCase().includes(q)
        );
      });
  }, [orders, filter]);

  const selected = activeOrders.find((o) => o.id === selectedId) ?? null;

  // Weight-managed items for the selected order
  const weightItems = useMemo(
    () =>
      (selected?.items || [])
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => isWeightItem(item)),
    [selected],
  );

  // Auto-select first pending weight item when order changes
  useEffect(() => {
    if (!selected) { setActiveItemIdx(null); return; }
    const firstPending = weightItems.findIndex(({ item }) => !asNumber(item.actual_weight));
    setActiveItemIdx(firstPending >= 0 ? weightItems[firstPending].idx : (weightItems[0]?.idx ?? null));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus weight input whenever active item changes
  useEffect(() => {
    if (activeItemIdx !== null) weightInputRef.current?.focus();
  }, [activeItemIdx, selectedId]);

  const activeEntry = activeItemIdx !== null
    ? (selected?.items || [])[activeItemIdx]
    : null;

  const activeKey = selected && activeItemIdx !== null ? `${selected.id}:${activeItemIdx}` : null;
  const activeInputVal = activeKey ? (weightInputs[activeKey] ?? '') : '';

  // "Weight X of Y" counters
  const weightPos = activeItemIdx !== null
    ? weightItems.findIndex((w) => w.idx === activeItemIdx) + 1
    : 0;

  function goNextPendingWeight() {
    if (!selected) return;
    const remaining = weightItems.filter(
      ({ item, idx }) => idx !== activeItemIdx && !asNumber(item.actual_weight),
    );
    if (remaining.length > 0) {
      setActiveItemIdx(remaining[0].idx);
    }
  }

  async function handleSave() {
    if (!selected || activeItemIdx === null) return;
    await onSaveWeight(selected.id, activeItemIdx);
    goNextPendingWeight();
  }

  // Ext amount for a single item
  function itemExt(item: OrderItem, inputVal?: string): number {
    const price = item.is_catch_weight ? asNumber(item.price_per_lb) : asNumber(item.unit_price);
    const qty = asNumber(item.quantity ?? item.requested_qty);
    const wt = asNumber(inputVal ?? item.actual_weight ?? 0) || asNumber(item.actual_weight);
    return item.is_catch_weight ? wt * price : qty * price;
  }

  // Running total of entered weights for this order
  const runningTotal = useMemo(() => {
    return weightItems.reduce((sum, { item, idx }) => {
      const key = selected ? `${selected.id}:${idx}` : '';
      const val = asNumber(weightInputs[key] ?? item.actual_weight ?? 0);
      return sum + val;
    }, 0);
  }, [weightItems, weightInputs, selected]);

  const allWeightsEntered = selected
    ? pendingWeightCount(selected) === 0
    : false;

  return (
    <div className="flex flex-col rounded-lg border border-border overflow-hidden bg-background" style={{ minHeight: '560px' }}>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          Weight Station
        </span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by customer or order #…"
          className="h-8 w-64 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {activeOrders.length} open order{activeOrders.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Top panel: order queue ─────────────────────────────────────────── */}
      <div className="overflow-auto border-b border-border" style={{ maxHeight: '230px' }}>
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-xs text-muted-foreground uppercase tracking-wide">
              {['Order #', 'Date', 'Route', 'Cust #', 'Ship-To Company', 'Items', 'Wts Needed', 'Status'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold border-b border-border whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground text-sm">
                  {filter ? 'No orders match the filter.' : 'No open orders waiting for weights.'}
                </td>
              </tr>
            )}
            {activeOrders.map((order) => {
              const sel = order.id === selectedId;
              const needsWt = pendingWeightCount(order);
              return (
                <tr
                  key={order.id}
                  onClick={() => setSelectedId(order.id)}
                  className={[
                    'cursor-pointer border-b border-border/40 transition-colors select-none',
                    sel
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-muted/60',
                  ].join(' ')}
                >
                  <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">
                    {order.order_number || order.id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                    {fmtDate(order.created_at)}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {(order as Record<string, unknown>).route_id as string || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono">
                    {(order as Record<string, unknown>).customer_id as string || '—'}
                  </td>
                  <td className="px-3 py-1.5 font-semibold whitespace-nowrap">
                    {order.customer_name || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-center">
                    {(order.items || []).length}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {needsWt > 0 ? (
                      <span className={[
                        'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold',
                        sel ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700',
                      ].join(' ')}>
                        {needsWt}
                      </span>
                    ) : (
                      <span className={sel ? 'text-white/70 text-xs' : 'text-emerald-600 text-xs font-bold'}>✓</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                      sel
                        ? 'bg-white/20 text-white'
                        : order.status === 'pending'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700',
                    ].join(' ')}>
                      {order.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Bottom panel ───────────────────────────────────────────────────── */}
      {selected ? (
        <div className="flex flex-col flex-1 min-h-0">

          {/* Addresses row */}
          <div className="grid grid-cols-2 gap-0 border-b border-border">
            {[
              { label: 'Bill To', name: selected.customer_name, addr: selected.customer_address, email: selected.customer_email },
              { label: 'Ship To', name: selected.customer_name, addr: selected.customer_address, email: null },
            ].map(({ label, name, addr, email }) => (
              <div key={label} className="px-4 py-2 border-r last:border-r-0 border-border bg-muted/20 text-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
                <p className="font-semibold leading-snug">{name || '—'}</p>
                {addr && <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{addr}</p>}
                {email && <p className="text-xs text-muted-foreground mt-0.5">{email}</p>}
              </div>
            ))}
          </div>

          {/* Items + weight widget */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* Items table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="text-xs text-muted-foreground uppercase tracking-wide">
                    {['Item #', 'UOM', 'Description', 'Lot #', 'Qty Ord', 'Req. Wt', 'Actual Wt', 'Ext Amt'].map((h) => (
                      <th key={h} className={[
                        'px-3 py-2 font-semibold border-b border-border whitespace-nowrap',
                        ['Qty Ord', 'Req. Wt', 'Actual Wt', 'Ext Amt'].includes(h) ? 'text-right' : 'text-left',
                      ].join(' ')}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(selected.items || []).map((item, idx) => {
                    const needsWt = isWeightItem(item);
                    const isActive = idx === activeItemIdx;
                    const actual = asNumber(item.actual_weight);
                    const requested = asNumber(item.requested_weight ?? item.estimated_weight ?? orderItemQty(item));
                    const qty = asNumber(item.quantity ?? item.requested_qty);
                    const key = `${selected.id}:${idx}`;
                    const ext = itemExt(item, weightInputs[key]);

                    return (
                      <tr
                        key={idx}
                        onClick={() => needsWt ? setActiveItemIdx(idx) : undefined}
                        className={[
                          'border-b border-border/40 transition-colors',
                          needsWt ? 'cursor-pointer' : '',
                          isActive ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : '',
                          !isActive && needsWt && !actual ? 'bg-amber-50/40 hover:bg-amber-50/70' : '',
                          !isActive && (!needsWt || actual > 0) ? 'hover:bg-muted/40' : '',
                        ].join(' ')}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{item.item_number || '—'}</td>
                        <td className="px-3 py-2 text-xs uppercase font-medium">{item.unit || 'LB'}</td>
                        <td className="px-3 py-2 font-medium">
                          {item.name || item.description || `Item ${idx + 1}`}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{item.lot_number || '—'}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {qty > 0 ? qty.toFixed(4) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {requested > 0 ? `${requested} lb` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold">
                          {actual > 0
                            ? <span className="text-emerald-700">{actual.toFixed(2)}</span>
                            : needsWt
                              ? <span className="text-amber-500">—</span>
                              : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {ext > 0 ? `$${ext.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Weight entry widget ─────────────────────────────────────── */}
            <div className="w-56 shrink-0 border-l border-border flex flex-col bg-muted/10">

              {/* Header */}
              <div className="border-b border-border px-3 py-2 bg-muted/30 text-center">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {weightItems.length > 0
                    ? `Weight ${weightPos} of ${weightItems.length}`
                    : 'Weights'}
                </p>
              </div>

              {/* Min / Max / Total */}
              <div className="grid grid-cols-3 border-b border-border text-center text-xs">
                {[
                  { label: 'Min.', value: 'N/A' },
                  { label: 'Max.', value: 'N/A' },
                  { label: 'Total', value: runningTotal > 0 ? runningTotal.toFixed(2) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="py-1.5 border-r last:border-r-0 border-border">
                    <p className="text-muted-foreground font-medium">{label}</p>
                    <p className="font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              {/* Big weight display */}
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-3">
                {activeEntry && activeKey ? (
                  <>
                    <p className="text-xs text-center text-muted-foreground leading-tight font-medium">
                      {activeEntry.name || activeEntry.description || `Item ${activeItemIdx! + 1}`}
                    </p>

                    {/* Highlighted weight input — mimics the blue bar in the screenshot */}
                    <input
                      ref={weightInputRef}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full rounded border-2 border-blue-400 bg-blue-50 px-3 py-3 text-center text-2xl font-bold tabular-nums text-blue-800 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200"
                      value={activeInputVal}
                      onChange={(e) => onWeightInputChange(activeKey, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSave();
                      }}
                    />

                    <p className="text-xs text-muted-foreground text-center">
                      {activeEntry.requested_weight || activeEntry.estimated_weight
                        ? `Req: ${asNumber(activeEntry.requested_weight ?? activeEntry.estimated_weight)} lb`
                        : 'Enter actual lbs'}
                    </p>

                    <Button
                      className="w-full"
                      disabled={!activeInputVal || savingWeight[activeKey]}
                      onClick={() => void handleSave()}
                    >
                      {savingWeight[activeKey] ? 'Saving…' : 'Save Weight'}
                    </Button>

                    {/* Navigate pending items */}
                    {weightItems.filter(({ item }) => !asNumber(item.actual_weight)).length > 1 && (
                      <button
                        className="text-xs text-blue-600 hover:underline"
                        onClick={goNextPendingWeight}
                      >
                        Skip to next →
                      </button>
                    )}
                  </>
                ) : allWeightsEntered ? (
                  <div className="text-center space-y-1">
                    <p className="text-2xl">✓</p>
                    <p className="text-sm font-semibold text-emerald-700">All weights entered</p>
                    <p className="text-xs text-muted-foreground">Order is ready to invoice</p>
                  </div>
                ) : (
                  <p className="text-xs text-center text-muted-foreground">
                    ← Click a row to enter its weight
                  </p>
                )}
              </div>

              {/* Item navigation dots */}
              {weightItems.length > 1 && (
                <div className="flex justify-center gap-1 border-t border-border py-2 px-3 flex-wrap">
                  {weightItems.map(({ item, idx }) => {
                    const captured = asNumber(item.actual_weight) > 0;
                    const isActive = idx === activeItemIdx;
                    return (
                      <button
                        key={idx}
                        title={item.name || item.description || `Item ${idx + 1}`}
                        onClick={() => setActiveItemIdx(idx)}
                        className={[
                          'h-3 w-3 rounded-full border transition-colors',
                          isActive ? 'bg-blue-500 border-blue-600' : captured ? 'bg-emerald-400 border-emerald-500' : 'bg-amber-300 border-amber-400',
                        ].join(' ')}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          ↑ Select an order above to enter weights
        </div>
      )}
    </div>
  );
}
