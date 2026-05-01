import { useMemo, useState } from 'react';
import type { InventoryProduct, LotCode, Order, OrderCharge, OrderLineDraft } from '../pages/orders.types';
import { asNumber, draftSubtotal, emptyLine, orderItemQty } from '../pages/orders.types';

export function useOrderForm({
  products,
  lotsCache,
}: {
  products: InventoryProduct[];
  lotsCache: Record<string, LotCode[]>;
}) {
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [customerName, setCustomerName]       = useState('');
  const [customerEmail, setCustomerEmail]     = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [notes, setNotes]                     = useState('');
  const [taxEnabled, setTaxEnabled]           = useState(false);
  const [taxRate, setTaxRate]                 = useState('0.09');
  const [fuelPercent, setFuelPercent]         = useState('');
  const [servicePercent, setServicePercent]   = useState('');
  const [minimumFlat, setMinimumFlat]         = useState('');
  const [lines, setLines]                     = useState<OrderLineDraft[]>([emptyLine()]);

  const subtotal = useMemo(() => draftSubtotal(lines), [lines]);

  const charges = useMemo(() => {
    const fuel    = asNumber(fuelPercent);
    const service = asNumber(servicePercent);
    const minimum = asNumber(minimumFlat);
    const rows: OrderCharge[] = [];
    if (fuel    > 0) rows.push({ key: 'fuel',    label: 'Fuel Surcharge', type: 'percent', value: fuel,    amount: parseFloat(((subtotal * fuel)    / 100).toFixed(2)) });
    if (service > 0) rows.push({ key: 'service', label: 'Service Fee',    type: 'percent', value: service, amount: parseFloat(((subtotal * service)  / 100).toFixed(2)) });
    if (minimum > 0) rows.push({ key: 'minimum', label: 'Minimum Charge', type: 'flat',    value: minimum, amount: parseFloat(minimum.toFixed(2)) });
    return rows;
  }, [subtotal, fuelPercent, servicePercent, minimumFlat]);

  const draftTotal = useMemo(
    () => subtotal + charges.reduce((sum, c) => sum + asNumber(c.amount), 0),
    [subtotal, charges]
  );

  function updateLine(index: number, key: keyof OrderLineDraft, value: string) {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const updated: OrderLineDraft = { ...line, [key]: value };
      if (key === 'itemNumber') {
        updated.lotId = '';
        const trimmed = value.trim();
        const prod = products.find((p) => p.item_number === trimmed);
        if (prod) {
          updated.isCatchWeight = !!prod.is_catch_weight;
          if (prod.is_catch_weight && prod.default_price_per_lb != null) {
            updated.pricePerLb = String(asNumber(prod.default_price_per_lb));
          }
          if (!prod.is_catch_weight) {
            updated.estimatedWeight = '';
            updated.pricePerLb = '';
          }
        }
      }
      return updated;
    }));
  }

  function toggleLineCatchWeight(index: number) {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const newCw = !line.isCatchWeight;
      return {
        ...line,
        isCatchWeight: newCw,
        estimatedWeight: newCw ? line.estimatedWeight : '',
        pricePerLb: newCw ? line.pricePerLb : '',
        quantity: newCw ? '' : line.quantity,
        unitPrice: newCw ? '' : line.unitPrice,
      };
    }));
  }

  function addLine()  { setLines((c) => [...c, emptyLine()]); }
  function removeLine(index: number) { setLines((c) => (c.length === 1 ? c : c.filter((_, i) => i !== index))); }

  function reset() {
    setEditingOrderId(null);
    setCustomerName(''); setCustomerEmail(''); setCustomerAddress('');
    setFulfillmentType('delivery');
    setNotes(''); setTaxEnabled(false); setTaxRate('0.09');
    setFuelPercent(''); setServicePercent(''); setMinimumFlat('');
    setLines([emptyLine()]);
  }

  function populate(order: Order) {
    setEditingOrderId(order.id);
    setCustomerName(order.customer_name || '');
    setCustomerEmail(order.customer_email || '');
    setCustomerAddress(order.customer_address || '');
    setFulfillmentType(String(order.fulfillment_type || '').toLowerCase() === 'pickup' ? 'pickup' : 'delivery');
    setNotes(order.notes || '');
    setTaxEnabled(!!order.tax_enabled);
    setTaxRate(String(order.tax_rate ?? 0.09));

    const existingFuel    = (order.charges || []).find((c) => c.key === 'fuel');
    const existingService = (order.charges || []).find((c) => c.key === 'service');
    const existingMinimum = (order.charges || []).find((c) => c.key === 'minimum');
    setFuelPercent(existingFuel    ? String(existingFuel.value    ?? '') : '');
    setServicePercent(existingService ? String(existingService.value ?? '') : '');
    setMinimumFlat(existingMinimum    ? String(existingMinimum.value  ?? '') : '');

    const draftLines = (order.items || []).map<OrderLineDraft>((item) => ({
      name:            String(item.name || item.description || ''),
      itemNumber:      String(item.item_number || ''),
      unit:            item.is_catch_weight ? 'lb' : (String(item.unit || '').toLowerCase() === 'lb' ? 'lb' : 'each'),
      quantity:        item.is_catch_weight ? '' : String(orderItemQty(item) || ''),
      unitPrice:       item.is_catch_weight ? '' : String(asNumber(item.unit_price) || ''),
      notes:           String(item.notes || ''),
      lotId:           String(item.lot_id || ''),
      isCatchWeight:   !!item.is_catch_weight,
      estimatedWeight: item.is_catch_weight ? String(asNumber(item.estimated_weight) || '') : '',
      pricePerLb:      item.is_catch_weight ? String(asNumber(item.price_per_lb) || '') : '',
    }));
    setLines(draftLines.length ? draftLines : [emptyLine()]);
  }

  function buildPayload() {
    const validLines = lines.filter((line) => {
      if (!line.name.trim()) return false;
      return line.isCatchWeight ? asNumber(line.estimatedWeight) > 0 : asNumber(line.quantity) > 0;
    });

    const items = validLines.map((line) => {
      if (line.isCatchWeight) {
        return {
          name:             line.name.trim(),
          item_number:      line.itemNumber.trim() || undefined,
          unit:             'lb' as const,
          is_catch_weight:  true,
          estimated_weight: asNumber(line.estimatedWeight),
          price_per_lb:     asNumber(line.pricePerLb),
          notes:            line.notes.trim() || undefined,
          lot_id:           line.lotId ? parseInt(line.lotId, 10) : undefined,
        };
      }
      const qty = asNumber(line.quantity);
      const base = {
        name:        line.name.trim(),
        item_number: line.itemNumber.trim() || undefined,
        unit:        line.unit,
        quantity:    qty,
        unit_price:  asNumber(line.unitPrice),
        notes:       line.notes.trim() || undefined,
        lot_id:      line.lotId ? parseInt(line.lotId, 10) : undefined,
      };
      return line.unit === 'lb'
        ? { ...base, requested_weight: qty }
        : { ...base, requested_qty: qty };
    });

    return {
      customerName:    customerName.trim(),
      customerEmail:   customerEmail.trim()   || '',
      customerAddress: fulfillmentType === 'delivery' ? customerAddress.trim() || '' : '',
      fulfillmentType,
      notes:           notes.trim() || '',
      taxEnabled,
      taxRate: asNumber(taxRate) || 0.09,
      charges,
      items,
    };
  }

  const ftlSet = useMemo(
    () => new Set(products.filter((p) => p.is_ftl_product).map((p) => p.item_number)),
    [products]
  );

  const catchWeightSet = useMemo(
    () => new Set(products.filter((p) => p.is_catch_weight).map((p) => p.item_number)),
    [products]
  );

  const defaultPriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) {
      if (p.is_catch_weight && p.default_price_per_lb != null) {
        map[p.item_number] = asNumber(p.default_price_per_lb);
      }
    }
    return map;
  }, [products]);

  return {
    // field state
    editingOrderId,
    customerName, setCustomerName,
    customerEmail, setCustomerEmail,
    customerAddress, setCustomerAddress,
    fulfillmentType, setFulfillmentType,
    notes, setNotes,
    taxEnabled, setTaxEnabled,
    taxRate, setTaxRate,
    fuelPercent, setFuelPercent,
    servicePercent, setServicePercent,
    minimumFlat, setMinimumFlat,
    lines,
    // derived
    subtotal, charges, draftTotal,
    ftlSet, catchWeightSet, defaultPriceMap,
    lotsCache,
    // actions
    updateLine, toggleLineCatchWeight, addLine, removeLine,
    reset, populate, buildPayload,
  };
}
