import { useState } from 'react';
import { Scale, X, Printer, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { sendWithAuth } from '../../lib/api';
import { cn } from '../../lib/utils';

// ── Types (mirrors orders.types.ts subset) ────────────────────────────────────

type OrderItem = {
  name?: string;
  description?: string;
  item_number?: string;
  unit?: string;
  is_catch_weight?: boolean;
  actual_weight?: number | string | null;
  requested_weight?: number | string | null;
  price_per_lb?: number | string | null;
  unit_price?: number | string | null;
  notes?: string;
};

type Order = {
  id: string;
  order_number?: string;
  customer_name?: string;
  customer_address?: string;
  status?: string;
  tax_enabled?: boolean;
  tax_rate?: number | string | null;
  items?: OrderItem[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hasPendingWeight(item: OrderItem): boolean {
  const isWeightManaged =
    item.is_catch_weight ||
    String(item.unit || '').toLowerCase() === 'lb' ||
    item.requested_weight !== undefined;
  return isWeightManaged && !(asNumber(item.actual_weight) > 0);
}

function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printOrderSlip(order: Order) {
  const popup = window.open('', '_blank', 'width=960,height=720');
  if (!popup) return;
  const rows = (order.items || []).map((item) => {
    const unit = item.is_catch_weight || String(item.unit || '').toLowerCase() === 'lb' ? 'lb' : 'ea';
    const qty = unit === 'lb' ? asNumber(item.actual_weight || item.requested_weight) : 1;
    const price = item.is_catch_weight ? asNumber(item.price_per_lb) : asNumber(item.unit_price);
    return `<tr>
      <td>${escapeHtml(item.name || item.description || item.item_number || '—')}</td>
      <td>${escapeHtml(item.notes || '')}</td>
      <td>${qty.toFixed(unit === 'lb' ? 2 : 0)} ${unit}</td>
      <td>$${price.toFixed(2)}</td>
    </tr>`;
  }).join('');
  const orderNumber = order.order_number || order.id.slice(0, 8);
  popup.document.open();
  popup.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Order ${escapeHtml(orderNumber)}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin-bottom:4px}
    .muted{color:#666;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th{background:#f5f5f5;padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;color:#666}
    td{padding:8px 12px;border-bottom:1px solid #e6e6e6;vertical-align:top}
    .print-actions{display:flex;justify-content:flex-end;margin-bottom:16px}
    .print-btn{background:#3dba7f;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px}
    @media print{.print-actions{display:none}body{padding:0.4in}}
  </style>
</head>
<body>
  <div class="print-actions"><button class="print-btn" onclick="window.print()">Print</button></div>
  <h1>Order ${escapeHtml(orderNumber)}</h1>
  <div class="muted">${escapeHtml(order.customer_name || 'No customer')} &middot; ${escapeHtml(order.customer_address || '')}</div>
  <table>
    <thead><tr><th>Item</th><th>Notes</th><th>Quantity</th><th>Price</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center">No line items</td></tr>'}</tbody>
  </table>
</body>
</html>`);
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 300);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WeightEntryModal({
  orders,
  onClose,
  onOrderUpdated,
}: {
  orders: Order[];
  onClose: () => void;
  onOrderUpdated: (updated: Order) => void;
}) {
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function setInput(key: string, value: string) {
    setWeightInputs((prev) => ({ ...prev, [key]: value }));
  }

  async function saveWeight(order: Order, itemIndex: number) {
    const key = `${order.id}:${itemIndex}`;
    const val = parseFloat(weightInputs[key] ?? '');
    if (!Number.isFinite(val) || val <= 0) {
      setError('Enter a valid weight greater than 0.');
      return;
    }
    setSaving((s) => ({ ...s, [key]: true }));
    setError('');
    try {
      const updated = await sendWithAuth<Order>(
        `/api/orders/${order.id}/items/${itemIndex}/actual-weight`,
        'PATCH',
        { actual_weight: val },
      );
      onOrderUpdated(updated);
      setSaved((s) => ({ ...s, [key]: true }));
      setNotice('Weight saved.');
      setTimeout(() => setNotice(''), 2500);
    } catch (err) {
      setError(String((err as Error).message || 'Could not save weight'));
    } finally {
      setSaving((s) => { const next = { ...s }; delete next[key]; return next; });
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="w-full max-w-4xl rounded-xl border border-border bg-background shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-700">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Weight Entry Queue</h2>
              <p className="text-xs text-muted-foreground">{orders.length} order{orders.length !== 1 ? 's' : ''} with pending weights</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Notices */}
        {error  && <div className="mx-6 mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
        {notice && <div className="mx-6 mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}

        {/* Order list */}
        <div className="divide-y divide-border">
          {orders.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">No orders with pending weights right now.</div>
          )}

          {orders.map((order) => {
            const pendingItems = (order.items || []).map((item, i) => ({ item, i })).filter(({ item }) => hasPendingWeight(item));
            if (!pendingItems.length) return null;
            const allSaved = pendingItems.every(({ i }) => saved[`${order.id}:${i}`]);

            return (
              <div key={order.id} className="px-6 py-5">
                {/* Order header row */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{order.customer_name || 'Unknown Customer'}</span>
                      <Badge variant="warning">{order.order_number || order.id.slice(0, 8)}</Badge>
                      {allSaved && <Badge variant="success">Ready to Print</Badge>}
                    </div>
                    {order.customer_address && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{order.customer_address}</div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={allSaved ? 'default' : 'outline'}
                    className={cn('gap-1.5', allSaved && 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600')}
                    onClick={() => printOrderSlip(order)}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print Invoice
                  </Button>
                </div>

                {/* Items needing weights */}
                <div className="mt-4 space-y-3">
                  {pendingItems.map(({ item, i }) => {
                    const key = `${order.id}:${i}`;
                    const isSaved = saved[key];
                    const isSaving = saving[key];
                    return (
                      <div
                        key={key}
                        className={cn(
                          'flex flex-wrap items-center gap-3 rounded-lg border p-3',
                          isSaved ? 'border-emerald-200 bg-emerald-50/50' : 'border-border bg-muted/20',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {item.name || item.description || item.item_number || 'Unnamed item'}
                          </div>
                          {item.requested_weight ? (
                            <div className="text-xs text-muted-foreground">Requested: {asNumber(item.requested_weight).toFixed(2)} lb</div>
                          ) : null}
                        </div>

                        {isSaved ? (
                          <div className="flex items-center gap-1.5 text-sm text-emerald-700 font-medium">
                            <CheckCircle2 className="h-4 w-4" />
                            {asNumber(item.actual_weight).toFixed(2)} lb saved
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder="0.00 lb"
                              className="w-28 rounded border border-input bg-background px-3 py-1.5 text-sm"
                              value={weightInputs[key] ?? ''}
                              onChange={(e) => setInput(key, e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveWeight(order, i); }}
                            />
                            <Button
                              size="sm"
                              disabled={isSaving || !weightInputs[key]}
                              onClick={() => void saveWeight(order, i)}
                            >
                              {isSaving ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
