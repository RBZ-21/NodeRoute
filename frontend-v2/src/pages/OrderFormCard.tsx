import { useMemo } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { asMoney, asNumber, fmtDate } from './orders.types';
import type { Customer, InventoryProduct, LotCode, OrderCharge, OrderLineDraft } from './orders.types';

type Props = {
  editingOrderId: string | null;
  // customer fields
  customerName: string; setCustomerName: (v: string) => void;
  customerEmail: string; setCustomerEmail: (v: string) => void;
  customerAddress: string; setCustomerAddress: (v: string) => void;
  fulfillmentType: 'delivery' | 'pickup'; setFulfillmentType: (v: 'delivery' | 'pickup') => void;
  customers: Customer[];
  // order fields
  notes: string; setNotes: (v: string) => void;
  taxEnabled: boolean; setTaxEnabled: (v: boolean) => void;
  taxRate: string; setTaxRate: (v: string) => void;
  fuelPercent: string; setFuelPercent: (v: string) => void;
  servicePercent: string; setServicePercent: (v: string) => void;
  minimumFlat: string; setMinimumFlat: (v: string) => void;
  // line items
  lines: OrderLineDraft[];
  products: InventoryProduct[];
  lotsCache: Record<string, LotCode[]>;
  ftlSet: Set<string>;
  catchWeightSet: Set<string>;
  // derived totals
  subtotal: number;
  charges: OrderCharge[];
  draftTotal: number;
  // actions
  updateLine: (index: number, key: keyof OrderLineDraft, value: string) => void;
  toggleLineCatchWeight: (index: number) => void;
  addLine: () => void;
  removeLine: (index: number) => void;
  onSubmit: (sendToProcessing: boolean) => void;
  onCancel: () => void;
  submitting: boolean;
};

export function OrderFormCard({
  editingOrderId,
  customerName, setCustomerName,
  customerEmail, setCustomerEmail,
  customerAddress, setCustomerAddress,
  fulfillmentType, setFulfillmentType,
  customers,
  notes, setNotes,
  taxEnabled, setTaxEnabled,
  taxRate, setTaxRate,
  fuelPercent, setFuelPercent,
  servicePercent, setServicePercent,
  minimumFlat, setMinimumFlat,
  lines, products, lotsCache, ftlSet, catchWeightSet,
  subtotal, charges, draftTotal,
  updateLine, toggleLineCatchWeight, addLine, removeLine,
  onSubmit, onCancel, submitting,
}: Props) {
  function normalizedCustomerName(value: string) {
    return value.trim().toLowerCase();
  }

  function customerAddressValue(customer: Customer) {
    return String(
      customer.address
      || customer.billing_address
      || customer.customer_address
      || customer.delivery_address
      || customer.shipping_address
      || customer.ship_to_address
      || ''
    ).trim();
  }

  function hydrateCustomerDetails(customer: Customer) {
    setCustomerName(customer.company_name || '');
    setCustomerEmail(customer.billing_email || '');
    setCustomerAddress(customerAddressValue(customer));
  }

  function hydrateCustomerByName(nextName: string) {
    const normalized = normalizedCustomerName(nextName);
    if (!normalized) return false;
    const match = customers.find((customer) => normalizedCustomerName(customer.company_name || '') === normalized);
    if (!match) return false;
    hydrateCustomerDetails(match);
    return true;
  }

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      label: c.company_name || '',
      sublabel: [c.phone_number, c.billing_email].filter(Boolean).join(' · '),
      value: c.id,
    })),
    [customers],
  );

  const productOptions = useMemo(
    () => products.map((p) => ({
      label: p.description,
      sublabel: `#${p.item_number}${p.unit ? ' · ' + p.unit : ''}${asNumber(p.cost) > 0 ? ' · $' + asNumber(p.cost).toFixed(2) : ''}`,
      value: p.item_number,
    })),
    [products],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editingOrderId ? 'Edit Order' : 'Create Order'}</CardTitle>
        <CardDescription>
          FTL-flagged products require a lot assignment (FSMA 204). Select the soonest-to-expire lot first (FEFO).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Customer Name</span>
            <Combobox
              value={customerName}
              onChange={(nextValue) => {
                setCustomerName(nextValue);
                hydrateCustomerByName(nextValue);
              }}
              onSelect={(opt) => {
                const c = customers.find((x) => x.id === opt.value);
                if (!c) return;
                hydrateCustomerDetails(c);
              }}
              options={customerOptions}
              placeholder="Oceanview Market"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Delivery Type</span>
            <select
              value={fulfillmentType}
              onChange={(e) => setFulfillmentType(e.target.value === 'pickup' ? 'pickup' : 'delivery')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="delivery">Delivery</option>
              <option value="pickup">Pickup</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Customer Email</span>
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="buyer@customer.com" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Customer Address</span>
            <Input
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder={fulfillmentType === 'delivery' ? '123 Harbor St' : 'Pickup order'}
              disabled={fulfillmentType === 'pickup'}
            />
          </label>
        </div>

        {fulfillmentType === 'delivery' ? (
          <p className="text-xs text-muted-foreground">Delivery orders keep the customer address and create a pending stop automatically.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Pickup orders do not create route stops.</p>
        )}

        <label className="space-y-1 text-sm">
          <span className="font-semibold text-muted-foreground">Notes</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special handling or packing notes" />
        </label>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Tax Enabled</span>
            <select value={taxEnabled ? 'yes' : 'no'} onChange={(e) => setTaxEnabled(e.target.value === 'yes')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Tax Rate</span>
            <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="0.09" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Fuel %</span>
            <Input value={fuelPercent} onChange={(e) => setFuelPercent(e.target.value)} placeholder="0" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Service % / Min $</span>
            <div className="flex gap-2">
              <Input value={servicePercent} onChange={(e) => setServicePercent(e.target.value)} placeholder="0" />
              <Input value={minimumFlat}    onChange={(e) => setMinimumFlat(e.target.value)}    placeholder="0" />
            </div>
          </label>
        </div>

        <div className="overflow-visible rounded-lg border border-border overflow-x-auto">
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
                const isFtl    = ftlSet.has(line.itemNumber.trim());
                const isCw     = line.isCatchWeight || catchWeightSet.has(line.itemNumber.trim());
                const lots     = lotsCache[line.itemNumber.trim()] || [];
                const needsLot = isFtl && !line.lotId;
                const lineTotal = isCw
                  ? asMoney(asNumber(line.estimatedWeight) * asNumber(line.pricePerLb))
                  : asMoney((line.unit === 'lb' ? asNumber(line.requestedWeight) : asNumber(line.quantity)) * asNumber(line.unitPrice));
                return (
                  <TableRow key={index} className={needsLot ? 'bg-amber-50/50' : ''}>
                    <TableCell>
                      <Combobox
                        value={line.name}
                        onChange={(v) => updateLine(index, 'name', v)}
                        onSelect={(opt) => {
                          const p = products.find((x) => x.item_number === opt.value);
                          if (!p) return;
                          const isCatchWeight = !!p.is_catch_weight;
                          updateLine(index, 'name', p.description);
                          updateLine(index, 'itemNumber', p.item_number);
                          updateLine(index, 'lotId', '');
                          if (isCatchWeight) {
                            updateLine(index, 'isCatchWeight', 'true');
                            if (p.default_price_per_lb != null) updateLine(index, 'pricePerLb', String(asNumber(p.default_price_per_lb)));
                          } else {
                            updateLine(index, 'unit', String(p.unit ?? 'lb').toLowerCase() === 'lb' ? 'lb' : 'each');
                            if (asNumber(p.cost) > 0) updateLine(index, 'unitPrice', String(asNumber(p.cost)));
                            updateLine(index, 'estimatedWeight', '');
                            updateLine(index, 'pricePerLb', '');
                          }
                        }}
                        options={productOptions}
                        placeholder="Atlantic Salmon"
                      />
                    </TableCell>
                    <TableCell>
                      <Input value={line.itemNumber} onChange={(e) => updateLine(index, 'itemNumber', e.target.value)} placeholder="SAL-01" />
                    </TableCell>
                    <TableCell>
                      {isCw ? (
                        <span className="inline-flex h-10 items-center px-3 text-sm text-muted-foreground">lb</span>
                      ) : (
                        <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={line.unit} onChange={(e) => updateLine(index, 'unit', e.target.value as 'lb' | 'each')}>
                          <option value="lb">lb</option>
                          <option value="each">each</option>
                        </select>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggleLineCatchWeight(index)}
                        title={line.isCatchWeight ? 'Catch weight ON — click to disable' : 'Enable catch weight for this line'}
                        className={['inline-flex h-6 w-11 items-center rounded-full transition-colors', line.isCatchWeight ? 'bg-orange-500' : 'bg-gray-200'].join(' ')}
                      >
                        <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', line.isCatchWeight ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
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
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={line.quantity}
                            onChange={(e) => updateLine(index, 'quantity', e.target.value)}
                            placeholder="Qty"
                          />
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            value={line.requestedWeight}
                            onChange={(e) => updateLine(index, 'requestedWeight', e.target.value)}
                            placeholder="Est. lbs"
                          />
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
                    </TableCell>
                    <TableCell>
                      {isCw
                        ? <span className="text-sm">{lineTotal}<span className="ml-1 text-xs text-muted-foreground">(est.)</span></span>
                        : lineTotal}
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

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={addLine}>Add Item</Button>
          <Button onClick={() => onSubmit(false)} disabled={submitting}>
            {editingOrderId ? 'Update Order' : 'Create Order'}
          </Button>
          <Button variant="secondary" onClick={() => onSubmit(true)} disabled={submitting}>
            {editingOrderId ? 'Update + Send' : 'Create + Send'}
          </Button>
          {editingOrderId ? <Button variant="ghost" onClick={onCancel}>Cancel Edit</Button> : null}
          <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            Subtotal <strong>{asMoney(subtotal)}</strong> · Charges <strong>{asMoney(charges.reduce((s, c) => s + asNumber(c.amount), 0))}</strong> ·
            Total <strong>{asMoney(draftTotal)}</strong>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LotSelector({ lots, value, isFtl, onChange }: {
  lots: LotCode[];
  value: string;
  isFtl: boolean;
  onChange: (val: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={['h-10 w-full rounded-md border bg-background px-3 text-sm', isFtl && !value ? 'border-amber-400 ring-1 ring-amber-300' : 'border-input'].join(' ')}
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
      </select>
      {isFtl && !value && <p className="text-xs text-amber-600">Lot required for FTL product (FSMA 204)</p>}
      {isFtl && lots.length === 0 && <p className="text-xs text-muted-foreground">No active lots on file — receive a PO first</p>}
    </div>
  );
}
