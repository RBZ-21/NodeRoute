import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { asMoney, asNumber, hasPendingWeight, orderHasPendingWeights, orderItemQty } from './orders.types';
import type { Order, OrderItem } from './orders.types';

type WeightBoardFilter = 'needs' | 'captured';

type Props = {
  orders: Order[];
  filter: WeightBoardFilter;
  role: string;
  weightInputs: Record<string, string>;
  savingWeight: Record<string, boolean>;
  onWeightInputChange: (key: string, value: string) => void;
  onSaveWeight: (orderId: string, itemIndex: number) => void;
};

type CustomerWeightGroup = {
  customerName: string;
  orders: Array<{
    order: Order;
    items: Array<{ item: OrderItem; itemIndex: number }>;
  }>;
};

function itemPricePerWeight(item: OrderItem): number {
  return item.is_catch_weight ? asNumber(item.price_per_lb) : asNumber(item.unit_price);
}

function itemEstimatedWeight(item: OrderItem): number {
  return item.is_catch_weight
    ? asNumber(item.estimated_weight)
    : asNumber(item.requested_weight ?? item.quantity);
}

function itemDisplayName(item: OrderItem, index: number): string {
  return item.name || item.description || item.item_number || `Item ${index + 1}`;
}

function groupOrders(orders: Order[], filter: WeightBoardFilter): CustomerWeightGroup[] {
  const groups = new Map<string, CustomerWeightGroup>();

  for (const order of orders) {
    const matchingItems = (order.items || [])
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => {
        if (filter === 'needs') return hasPendingWeight(item);
        return !hasPendingWeight(item) && itemPricePerWeight(item) >= 0 && itemEstimatedWeight(item) > 0;
      });

    if (!matchingItems.length) continue;
    const customerName = String(order.customer_name || order.customer_email || 'Unnamed Customer').trim() || 'Unnamed Customer';
    const existing = groups.get(customerName);
    if (existing) {
      existing.orders.push({ order, items: matchingItems });
    } else {
      groups.set(customerName, { customerName, orders: [{ order, items: matchingItems }] });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.customerName.localeCompare(b.customerName));
}

export function OrderWeightsBoard({
  orders,
  filter,
  role,
  weightInputs,
  savingWeight,
  onWeightInputChange,
  onSaveWeight,
}: Props) {
  const canCapture = role === 'admin' || role === 'manager';
  const groups = groupOrders(orders, filter);
  const title = filter === 'needs' ? 'Weight Entry Queue' : 'Captured Weights';
  const description = filter === 'needs'
    ? 'Run down open customers that still need actual weights entered.'
    : 'Review open customers whose weight-managed items already have actual weights entered.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.length ? (
          groups.map((group) => (
            <div key={group.customerName} className="rounded-lg border border-border bg-card">
              <div className="border-b border-border bg-muted/20 px-4 py-3">
                <div className="text-base font-semibold text-foreground">{group.customerName}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {group.orders.length} order{group.orders.length === 1 ? '' : 's'} ·{' '}
                  {group.orders.reduce((sum, entry) => sum + entry.items.length, 0)} item{group.orders.reduce((sum, entry) => sum + entry.items.length, 0) === 1 ? '' : 's'}
                </div>
              </div>
              <div className="space-y-3 p-4">
                {group.orders.map(({ order, items }) => (
                  <div key={order.id} className="rounded-md border border-border/70 bg-muted/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
                      <div className="text-sm font-semibold text-foreground">{order.order_number || order.id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{orderHasPendingWeights(order) ? 'Pending weight entry' : 'Weights entered'}</div>
                    </div>
                    <div className="space-y-3 pt-3">
                      {items.map(({ item, itemIndex }) => {
                        const key = `${order.id}:${itemIndex}`;
                        const estimatedWeight = itemEstimatedWeight(item);
                        const actualWeight = asNumber(item.actual_weight);
                        const pricePerWeight = itemPricePerWeight(item);
                        const total = asMoney(orderItemQty(item) * pricePerWeight);

                        return (
                          <div key={key} className="grid gap-3 rounded-md border border-border/60 bg-background px-3 py-3 md:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))] md:items-center">
                            <div>
                              <div className="text-sm font-medium text-foreground">{itemDisplayName(item, itemIndex)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {String(item.unit || '').toLowerCase() === 'lb' && asNumber(item.requested_qty) > 0 ? `Qty: ${asNumber(item.requested_qty)} · ` : ''}
                                ${pricePerWeight.toFixed(4)}/lb
                              </div>
                            </div>
                            <Metric label="Estimated" value={`${estimatedWeight.toFixed(3)} lbs`} />
                            <Metric
                              label="Actual"
                              value={actualWeight > 0 ? `${actualWeight.toFixed(3)} lbs` : 'Not entered'}
                              tone={actualWeight > 0 ? 'text-foreground' : 'text-amber-600'}
                            />
                            <Metric label="Line Total" value={total} />
                            {canCapture ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  min="0.001"
                                  step="0.001"
                                  placeholder="0.000"
                                  value={weightInputs[key] ?? (actualWeight > 0 ? String(actualWeight) : '')}
                                  onChange={(event) => onWeightInputChange(key, event.target.value)}
                                  className="w-28"
                                />
                                <Button
                                  size="sm"
                                  disabled={!!savingWeight[key]}
                                  onClick={() => onSaveWeight(order.id, itemIndex)}
                                >
                                  {savingWeight[key] ? 'Saving…' : actualWeight > 0 ? 'Update' : 'Save'}
                                </Button>
                              </div>
                            ) : (
                              <Metric label="Status" value={actualWeight > 0 ? 'Captured' : 'Awaiting entry'} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
            {filter === 'needs'
              ? 'No open orders are waiting on weight entry.'
              : 'No open orders have captured weights yet.'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone = 'text-foreground' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${tone}`}>{value}</div>
    </div>
  );
}
