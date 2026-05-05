import { useState } from 'react';
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

  const activeOrders = orders.filter((o) => {
    const s = String(o.status || '').toLowerCase();
    return s === 'pending' || s === 'in_process';
  });

  const selected = activeOrders.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-background">

      {/* ── Top panel: order list ───────────────────────────────────────────── */}
      <div className="overflow-auto border-b border-border" style={{ maxHeight: '260px' }}>
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
                  No pending orders
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
                    sel ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60',
                  ].join(' ')}
                >
                  <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">
                    {order.order_number || order.id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                    {order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {(order as Record<string, unknown>).route_id as string || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {(order as Record<string, unknown>).customer_id as string || '—'}
                  </td>
                  <td className="px-3 py-1.5 font-medium whitespace-nowrap">
                    {order.customer_name || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-center">
                    {(order.items || []).length}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {needsWt > 0 ? (
                      <span className={[
                        'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
                        sel ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700',
                      ].join(' ')}>
                        {needsWt}
                      </span>
                    ) : (
                      <span className={sel ? 'text-primary-foreground/60 text-xs' : 'text-emerald-600 text-xs'}>✓</span>
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

      {/* ── Bottom panel: weight entry ──────────────────────────────────────── */}
      {selected ? (
        <div className="flex" style={{ minHeight: '280px' }}>

          {/* Bill To sidebar */}
          <div className="w-52 shrink-0 border-r border-border bg-muted/30 p-4 space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Bill To</p>
              <p className="font-semibold leading-snug">{selected.customer_name || '—'}</p>
              {selected.customer_address && (
                <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {selected.customer_address}
                </p>
              )}
              {selected.customer_email && (
                <p className="mt-1 text-xs text-muted-foreground">{selected.customer_email}</p>
              )}
            </div>
            {selected.notes && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                <p className="text-xs text-muted-foreground">{selected.notes}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Order</p>
              <p className="text-xs font-mono">{selected.order_number}</p>
              <p className="text-xs text-muted-foreground">
                {selected.created_at ? new Date(selected.created_at).toLocaleDateString() : ''}
              </p>
            </div>
          </div>

          {/* Items + weight entry table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="text-xs text-muted-foreground uppercase tracking-wide">
                  {['Item #', 'UOM', 'Description', 'Lot #', 'Qty Ord', 'Req. Wt', 'Actual Wt', '$/Unit', 'Ext Amt', ''].map((h) => (
                    <th key={h} className={[
                      'px-3 py-2 font-semibold border-b border-border whitespace-nowrap',
                      ['Qty Ord', 'Req. Wt', 'Actual Wt', '$/Unit', 'Ext Amt'].includes(h) ? 'text-right' : 'text-left',
                    ].join(' ')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(selected.items || []).map((item, idx) => {
                  const needsWt = isWeightItem(item);
                  const key = `${selected.id}:${idx}`;
                  const actualSaved = asNumber(item.actual_weight);
                  const requested = asNumber(
                    item.requested_weight ?? item.estimated_weight ?? orderItemQty(item)
                  );
                  const inputVal = weightInputs[key] ?? (actualSaved > 0 ? String(actualSaved) : '');
                  const price = item.is_catch_weight
                    ? asNumber(item.price_per_lb)
                    : asNumber(item.unit_price);
                  const qty = asNumber(item.quantity ?? item.requested_qty);
                  const effectiveWt = asNumber(inputVal) || actualSaved;
                  const extAmt = item.is_catch_weight
                    ? effectiveWt * price
                    : qty * price;

                  return (
                    <tr
                      key={idx}
                      className={[
                        'border-b border-border/40',
                        needsWt && !actualSaved ? 'bg-amber-50/30' : '',
                      ].join(' ')}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{item.item_number || '—'}</td>
                      <td className="px-3 py-2 text-xs uppercase">{item.unit || '—'}</td>
                      <td className="px-3 py-2 font-medium">
                        {item.name || item.description || `Item ${idx + 1}`}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{item.lot_number || '—'}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {qty > 0 ? qty : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {requested > 0 ? `${requested} lb` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {needsWt ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            className={[
                              'w-24 rounded border bg-background px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring',
                              actualSaved > 0 ? 'border-emerald-400' : 'border-amber-300',
                            ].join(' ')}
                            value={inputVal}
                            onChange={(e) => onWeightInputChange(key, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void onSaveWeight(selected.id, idx);
                            }}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {price > 0 ? `$${price.toFixed(4)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums font-medium">
                        {extAmt > 0 ? `$${extAmt.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {needsWt && (
                          <Button
                            size="sm"
                            disabled={savingWeight[key]}
                            onClick={() => void onSaveWeight(selected.id, idx)}
                          >
                            {savingWeight[key] ? '…' : 'Save'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          ↑ Select an order above to enter weights
        </div>
      )}
    </div>
  );
}
