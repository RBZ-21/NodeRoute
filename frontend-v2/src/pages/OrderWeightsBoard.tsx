import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import type { Order } from './orders.types';
import { asNumber, orderItemQty } from './orders.types';

export interface OrderWeightsBoardProps {
  orders: Order[];
  filter: 'needs' | 'captured';
  role: 'admin' | 'manager' | 'driver' | 'unknown';
  weightInputs: Record<string, string>;
  savingWeight: Record<string, boolean>;
  onWeightInputChange: (key: string, value: string) => void;
  onSaveWeight: (orderId: string, itemIndex: number) => Promise<void>;
}

export function OrderWeightsBoard({
  orders,
  filter,
  weightInputs,
  savingWeight,
  onWeightInputChange,
  onSaveWeight,
}: OrderWeightsBoardProps) {
  const title = filter === 'needs' ? 'Orders Needing Weights' : 'Weights Entered';
  const description =
    filter === 'needs'
      ? 'Enter actual weights for catch-weight and lb-unit items on open orders.'
      : 'Open orders whose weight-managed items already have actual weights captured.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="rounded-lg border border-border bg-card p-2">
        {orders.length ? (
          orders.map((order) => (
            <div key={order.id} className="mb-4 last:mb-0">
              <div className="mb-2 text-sm font-semibold text-foreground">
                {order.order_number || order.id.slice(0, 8)} &mdash; {order.customer_name || 'Unknown customer'}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Actual Weight</TableHead>
                    <TableHead>Status</TableHead>
                    {filter === 'needs' ? <TableHead>Enter Weight</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(order.items || []).map((item, idx) => {
                    const isCatchWeight =
                      item.is_catch_weight ||
                      String(item.unit || '').toLowerCase() === 'lb' ||
                      item.requested_weight !== undefined;
                    if (!isCatchWeight) return null;
                    const key = `${order.id}:${idx}`;
                    const actual = asNumber(item.actual_weight);
                    const requested = asNumber(item.requested_weight ?? orderItemQty(item));
                    return (
                      <TableRow key={key}>
                        <TableCell className="font-medium">
                          {item.name || item.description || item.item_number || `Item ${idx + 1}`}
                        </TableCell>
                        <TableCell>{requested > 0 ? `${requested} lb` : '—'}</TableCell>
                        <TableCell>
                          {actual > 0 ? (
                            <span className="font-semibold text-emerald-700">{actual} lb</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={actual > 0 ? 'success' : 'warning'}>
                            {actual > 0 ? 'Captured' : 'Pending'}
                          </Badge>
                        </TableCell>
                        {filter === 'needs' ? (
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="lbs"
                                className="w-24 rounded border border-input bg-background px-2 py-1 text-sm"
                                value={weightInputs[key] ?? ''}
                                onChange={(e) => onWeightInputChange(key, e.target.value)}
                              />
                              <Button
                                size="sm"
                                disabled={savingWeight[key]}
                                onClick={() => void onSaveWeight(order.id, idx)}
                              >
                                {savingWeight[key] ? '...' : 'Save'}
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ))
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {filter === 'needs'
              ? 'No open orders are currently missing weights.'
              : 'No open orders have captured weights yet.'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
