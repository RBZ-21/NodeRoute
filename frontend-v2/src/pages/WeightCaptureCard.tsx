import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { asMoney, asNumber, hasPendingWeight, isWeightManagedItem } from './orders.types';
import type { Order } from './orders.types';

type Props = {
  order: Order;
  weightInputs: Record<string, string>;
  savingWeight: Record<string, boolean>;
  role: string;
  onWeightInputChange: (key: string, value: string) => void;
  onSaveWeight: (orderId: string, itemIndex: number) => void;
};

export function WeightCaptureCard({
  order, weightInputs, savingWeight, role, onWeightInputChange, onSaveWeight,
}: Props) {
  const canCapture = role === 'admin' || role === 'manager';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capture Actual Weights — {order.order_number || order.id.slice(0, 8)}</CardTitle>
        <CardDescription>
          Enter the actual measured weight for each pound-based item. Line totals recalculate on save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Est. Weight</TableHead>
              <TableHead>Actual Weight</TableHead>
              <TableHead>Price/lb</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Variance</TableHead>
              {canCapture ? <TableHead>Capture</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(order.items || []).map((item, idx) => {
              if (!isWeightManagedItem(item)) return null;
              const key = `${order.id}:${idx}`;
              const est = item.is_catch_weight
                ? asNumber(item.estimated_weight)
                : asNumber(item.requested_weight ?? item.quantity);
              const act = asNumber(item.actual_weight);
              const ppl = item.is_catch_weight ? asNumber(item.price_per_lb) : asNumber(item.unit_price);
              const confirmed = act > 0;
              const variance = confirmed ? parseFloat((act - est).toFixed(3)) : null;
              const within10Pct = variance !== null && est > 0 && Math.abs(variance / est) <= 0.1;
              return (
                <TableRow key={idx}>
                  <TableCell className="font-medium">
                    <div>{item.name || item.description || `Item ${idx + 1}`}</div>
                    {String(item.unit || '').toLowerCase() === 'lb' && !item.is_catch_weight && asNumber(item.requested_qty) > 0 ? (
                      <div className="text-xs text-muted-foreground">Ordered qty: {asNumber(item.requested_qty)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{est.toFixed(3)} lbs</TableCell>
                  <TableCell>
                    {confirmed
                      ? <span className="font-semibold">{act.toFixed(3)} lbs</span>
                      : <span className="text-muted-foreground text-xs">{hasPendingWeight(item) ? 'Not captured' : '—'}</span>}
                  </TableCell>
                  <TableCell>${ppl.toFixed(4)}/lb</TableCell>
                  <TableCell>
                    {confirmed
                      ? asMoney(act * ppl)
                      : <span className="text-muted-foreground text-xs">{asMoney(est * ppl)} (est.)</span>}
                  </TableCell>
                  <TableCell>
                    {variance !== null ? (
                      <span className={variance === 0 ? '' : within10Pct ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        {variance > 0 ? '+' : ''}{variance.toFixed(3)} lbs
                      </span>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  {canCapture ? (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0.001"
                          step="0.001"
                          placeholder="0.000"
                          value={weightInputs[key] ?? (confirmed ? String(act) : '')}
                          onChange={(e) => onWeightInputChange(key, e.target.value)}
                          className="w-28"
                        />
                        <Button
                          size="sm"
                          disabled={!!savingWeight[key]}
                          onClick={() => onSaveWeight(order.id, idx)}
                        >
                          {savingWeight[key] ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
