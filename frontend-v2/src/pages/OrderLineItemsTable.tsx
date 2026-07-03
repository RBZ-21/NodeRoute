import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Combobox, type ComboboxOption } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { SelectInput } from '../components/ui/select-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { cn } from '../lib/utils';
import type { Role } from '../lib/api';
import { asMoney, asNumber, fmtDate, normalizeText, productSelectionKey } from './orders.types';
import type { InventoryProduct, LotCode, OrderLineDraft } from './orders.types';
import type { ResolvedLinePrice } from './OrderFormCard';

function LotSelector({ lots, value, isFtl, onChange }: {
  lots: LotCode[];
  value: string;
  isFtl: boolean;
  onChange: (val: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      <SelectInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('w-full', isFtl && !value && 'border-amber-400 ring-1 ring-amber-300')}
      >
        <option value="">{isFtl ? '— Select lot (required) —' : '— No lot —'}</option>
        {lots.map((lot) => {
          const expLabel = lot.expiration_date ? ` · exp ${fmtDate(lot.expiration_date)}` : '';
          const daysLeft = lot.expiration_date
            ? Math.floor((new Date(lot.expiration_date).getTime() - Date.now()) / 86_400_000)
            : null;
          const urgency  = daysLeft !== null && daysLeft <= 7 ? ' ⚠' : daysLeft !== null && daysLeft <= 30 ? ' ·' : '';
          return (
            <option key={lot.id} value={String(lot.id)}>
              {lot.lot_number}{expLabel}{urgency}
            </option>
          );
        })}
      </SelectInput>
      {isFtl && !value && <p className="text-xs text-amber-600">Lot required for FTL product (FSMA 204)</p>}
      {isFtl && lots.length === 0 && <p className="text-xs text-muted-foreground">No active lots on file — receive a PO first</p>}
    </div>
  );
}

export function OrderLineItemsTable({
  lines,
  products,
  ftlSet,
  catchWeightSet,
  lotsCache,
  resolvedLinePrices,
  userRole,
  productOptions,
  productsLoading,
  updateLine,
  applyProductSelection,
  onBrowseLine,
  toggleLineCatchWeight,
  removeLine,
}: {
  lines: OrderLineDraft[];
  products: InventoryProduct[];
  ftlSet: Set<string>;
  catchWeightSet: Set<string>;
  lotsCache: Record<string, LotCode[]>;
  resolvedLinePrices: Record<number, ResolvedLinePrice>;
  userRole: Role;
  productOptions: ComboboxOption[];
  productsLoading?: boolean;
  updateLine: (index: number, key: keyof OrderLineDraft, value: string) => void;
  applyProductSelection: (index: number, product: InventoryProduct) => void;
  onBrowseLine: (index: number) => void;
  toggleLineCatchWeight: (index: number) => void;
  removeLine: (index: number) => void;
}) {
  return (
    <div className="table-scroll-container overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Item #</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead><span title="Catch weight products are invoiced by actual measured weight">CW</span></TableHead>
            <TableHead>Qty / Est. Wt</TableHead>
            <TableHead>Unit Price / $/lb</TableHead>
            <TableHead>Line Total</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead>
              Lot
              <span className="ml-1 text-xs font-normal text-amber-600">(FTL req'd)</span>
            </TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, index) => {
            const productLookupKey = normalizeText(line.productId) || line.itemNumber.trim();
            const isFtl    = ftlSet.has(productLookupKey);
            const isCw     = line.isCatchWeight || catchWeightSet.has(productLookupKey);
            const lots     = lotsCache[line.itemNumber.trim()] || [];
            const needsLot = isFtl && !line.lotId;
            const lineProduct = products.find((p) => productSelectionKey(p) === line.productId)
              || (line.itemNumber.trim() ? products.find((p) => normalizeText(p.item_number) === line.itemNumber.trim()) : undefined);
            const landedCost = lineProduct ? asNumber(lineProduct.landed_cost) : 0;
            const realCost   = lineProduct ? asNumber(lineProduct.real_cost)   : 0;
            const lineTotal = isCw
              ? asMoney(asNumber(line.estimatedWeight) * asNumber(line.pricePerLb))
              : asMoney((line.unit === 'lb' ? asNumber(line.requestedWeight) : asNumber(line.quantity)) * asNumber(line.unitPrice));
            const resolvedPrice = resolvedLinePrices[index];
            const minSell = resolvedPrice?.minimum_sell;
            const belowMinimum = minSell && minSell.allowed === false && minSell.min_price != null;
            const canOverrideMinimum = userRole === 'admin' || userRole === 'superadmin';
            return (
              <TableRow key={index} className={needsLot ? 'bg-amber-50/50' : ''}>
                <TableCell>
                  <div className="min-w-[240px] space-y-2">
                    <Combobox
                      value={line.name}
                      onChange={(v) => updateLine(index, 'name', v)}
                      onSelect={(opt) => {
                        const matched = products.find((product) => productSelectionKey(product) === opt.value);
                        if (matched) {
                          applyProductSelection(index, matched);
                          return;
                        }
                        updateLine(index, 'name', opt.label);
                        updateLine(index, 'itemNumber', '');
                        updateLine(index, 'productId', '');
                      }}
                      options={productOptions}
                      disabled={productsLoading}
                      placeholder={productsLoading ? 'Loading products…' : 'Atlantic Salmon'}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => onBrowseLine(index)}>
                      Browse Inventory
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <Input value={line.itemNumber} onChange={(e) => updateLine(index, 'itemNumber', e.target.value)} placeholder="Optional item #" />
                </TableCell>
                <TableCell>
                  {isCw ? (
                    <span className="inline-flex h-10 items-center px-3 text-sm text-muted-foreground">lb</span>
                  ) : (
                    <SelectInput className="w-full"
                      value={line.unit} onChange={(e) => updateLine(index, 'unit', e.target.value as 'lb' | 'each')}>
                      <option value="lb">lb</option>
                      <option value="each">each</option>
                    </SelectInput>
                  )}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => toggleLineCatchWeight(index)}
                    title={line.isCatchWeight ? 'Catch weight ON — click to disable' : 'Enable catch weight for this line'}
                    aria-label={line.isCatchWeight ? 'Disable catch weight for this line' : 'Enable catch weight for this line'}
                    className={['inline-flex h-6 w-11 items-center rounded-full transition-colors', line.isCatchWeight ? 'bg-orange-500' : 'bg-gray-200'].join(' ')}
                  >
                    <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', line.isCatchWeight ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
                    <span className="sr-only">{line.isCatchWeight ? 'Catch weight on' : 'Catch weight off'}</span>
                  </button>
                </TableCell>
                <TableCell>
                  {isCw ? (
                    <div className="space-y-0.5">
                      <Input type="number" min="0" step="0.001" value={line.estimatedWeight}
                        onChange={(e) => updateLine(index, 'estimatedWeight', e.target.value)} placeholder="0.000 lbs" />
                      <p className="text-xs text-muted-foreground">Est. weight (lbs)</p>
                    </div>
                  ) : line.unit === 'lb' ? (
                    <div className="space-y-1">
                      <Input type="number" min="0" step="1" value={line.quantity}
                        onChange={(e) => updateLine(index, 'quantity', e.target.value)} placeholder="Qty" />
                      <Input type="number" min="0" step="0.001" value={line.requestedWeight}
                        onChange={(e) => updateLine(index, 'requestedWeight', e.target.value)} placeholder="Est. lbs" />
                      <p className="text-xs text-muted-foreground">Ordered qty and estimated total lbs</p>
                    </div>
                  ) : (
                    <Input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} />
                  )}
                </TableCell>
                <TableCell>
                  {isCw ? (
                    <div className="space-y-0.5">
                      <Input type="number" min="0" step="0.0001" value={line.pricePerLb}
                        onChange={(e) => updateLine(index, 'pricePerLb', e.target.value)} placeholder="0.0000" />
                      <p className="text-xs text-muted-foreground">$ per lb</p>
                    </div>
                  ) : (
                    <Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', e.target.value)} />
                  )}
                  {resolvedPrice && (
                    <div className="mt-1 space-y-1 text-[11px] leading-tight text-muted-foreground">
                      <div>Resolved {asMoney(asNumber(resolvedPrice.price))} · {resolvedPrice.method.replace(/_/g, ' ')}</div>
                      {belowMinimum && (
                        <Badge variant={canOverrideMinimum ? 'warning' : 'destructive'} className="whitespace-nowrap">
                          Min {asMoney(asNumber(minSell.min_price))}{canOverrideMinimum ? ' override' : ''}
                        </Badge>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {isCw
                    ? <span className="text-sm">{lineTotal}<span className="ml-1 text-xs text-muted-foreground">(est.)</span></span>
                    : lineTotal}
                  {(landedCost > 0 || realCost > 0) && (
                    <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                      {landedCost > 0 && <div title="Landed cost: base + freight, duties, handling">Landed {asMoney(landedCost)}</div>}
                      {realCost   > 0 && <div title="Real cost: true all-in cost after overrides">Real {asMoney(realCost)}</div>}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Input value={line.notes} onChange={(e) => updateLine(index, 'notes', e.target.value)} placeholder="Optional" />
                </TableCell>
                <TableCell className="min-w-[200px]">
                  {line.itemNumber.trim() ? (
                    <LotSelector
                      lots={lots}
                      value={line.lotId}
                      isFtl={isFtl}
                      onChange={(val) => updateLine(index, 'lotId', val)}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Enter item # first</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => removeLine(index)}>Remove</Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
