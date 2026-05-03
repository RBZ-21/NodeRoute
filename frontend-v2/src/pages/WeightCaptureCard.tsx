import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { asNumber, orderItemQty } from './orders.types';
import type { Order } from './orders.types';
import type { Role } from '../lib/api';

export interface WeightCaptureCardProps {
  order: Order;
  role: Role;
  weightInputs: Record<string, string>;
  savingWeight: Record<string, boolean>;
  onWeightInputChange: (key: string, val: string) => void;
  onSaveWeight: (orderId: string, itemIndex: number) => Promise<void>;
}

export function WeightCaptureCard({
  order,
  weightInputs,
  savingWeight,
  onWeightInputChange,
  onSaveWeight,
}: WeightCaptureCardProps) {
  const weightItems = (order.items || []).filter(
    (item) =>
      item.is_catch_weight ||
      String(item.unit || '').toLowerCase() === 'lb' ||
      item.requested_weight !== undefined,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Weight Entry — {order.order_number || order.id.slice(0, 8)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {weightItems.length ? (
          weightItems.map((item, idx) => {
            const key = `${order.id}:${idx}`;
            const actual = asNumber(item.actual_weight);
            const requested = asNumber(item.requested_weight ?? orderItemQty(item));
            return (
              <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {item.name || item.description || item.item_number || `Item ${idx + 1}`}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Requested: {requested > 0 ? `${requested} lb` : '—'}
                    {actual > 0 ? ` · Last: ${actual} lb` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="lbs"
                    className="w-24 rounded border border-input bg-background px-2 py-1 text-sm"
                    value={weightInputs[key] ?? ''}
                    onChange={(e) => onWeightInputChange(key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void onSaveWeight(order.id, idx);
                    }}
                  />
                  <span className="text-sm text-muted-foreground">lbs</span>
                  <Button
                    size="sm"
                    disabled={savingWeight[key]}
                    onClick={() => void onSaveWeight(order.id, idx)}
                  >
                    {savingWeight[key] ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-sm text-muted-foreground">No weight-managed items on this order.</div>
        )}
      </CardContent>
    </Card>
  );
}
