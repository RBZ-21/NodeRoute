import { useMemo, useState } from 'react';
import type { InventoryProduct, LotCode, Order, OrderCharge, OrderLineDraft } from '../pages/orders.types';
import { asNumber, draftSubtotal, emptyLine, normalizeText, orderItemQty, productSelectionKey } from '../pages/orders.types';

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
  const [routeId, setRouteId]                 = useState('');

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

  function hydrateLineFromProduct(line: OrderLineDraft, product: InventoryProduct | undefined): OrderLineDraft {
    if (!product) return { ...line, productId: '', itemNumber: normalizeText(line.itemNumber) };

    const updated: OrderLineDraft = {
      ...line,
      productId: normalizeText(product.id),
      itemNumber: normalizeText(product.item_number),
      name: normalizeText(product.description) || line.name,
      lotId: '',
      isCatchWeight: !!product.is_catch_weight,
    };

    if (product.is_catch_weight) {
      updated.unit = 'lb';
      if (product.default_price_per_lb != null) {
        updated.pricePerLb = String(asNumber(product.default_price_per_lb));
      }
      updated.estimatedWeight = updated.estimatedWeight || '';
      updated.quantity = '';
      updated.requestedWeight = '';
      updated.unitPrice = '';
      return updated;
    }

    updated.unit = normalizeText(product.unit).toLowerCase() === 'lb' ? 'lb' : 'each';
    if (asNumber(product.cost) > 0) updated.unitPrice = String(asNumber(product.cost));
    updated.estimatedWeight = '';
    updated.pricePerLb = '';
    return updated;
  }

  // updateLine handles both plain string fields and the special itemNumber hydration.
  // When itemNumber is set, it looks up the matching product and fills in name, unit,
  // price, and catch-weight fields automatically — so callers only need one updateLine call.
  function updateLine(index: number, key: keyof OrderLineDraft, value: string) {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;

      if (key === 'productId') {
        const trimmed = normalizeText(value);
        const prod = products.find((p) => productSelectionKey(p) === trimmed || normalizeText(p.id) === trimmed);
        if (!prod) return { ...line, productId: '', lotId: '' };
        return hydrateLineFromProduct(line, prod);
      }

      if (key === 'itemNumber') {
        const trimmed = normalizeText(value);
        const prod = products.find((p) => normalizeText(p.item_number) === trimmed);
        const updated = hydrateLineFromProduct({
          ...line,
          productId: prod ? normalizeText(prod.id) : '',
          itemNumber: trimmed,
          lotId: '',
        }, prod);
        return prod ? updated : { ...updated, itemNumber: trimmed, productId: '' };
      }

      // For all other string fields, spread the value normally.
      // isCatchWeight is boolean and must not be set via this path —
      // use toggleLineCatchWeight instead.
      return { ...line, [key]: value };
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
        requestedWeight: newCw ? '' : line.requestedWeight,
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
    setRouteId('');
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
      productId:       normalizeText(
        item.product_id
        || products.find((product) =>
          (normalizeText(item.product_id) && normalizeText(product.id) === normalizeText(item.product_id))
          || (normalizeText(item.item_number) && normalizeText(product.item_number) === normalizeText(item.item_number))
        )?.id
      ),
      name:            String(item.name || item.description || ''),
      itemNumber:      String(item.item_number || ''),
      unit:            item.is_catch_weight ? 'lb' : (String(item.unit || '').toLowerCase() === 'lb' ? 'lb' : 'each'),
      quantity:        item.is_catch_weight
        ? ''
        : String(
          item.requested_qty
          ?? (String(item.unit || '').toLowerCase() === 'lb' ? '' : orderItemQty(item))
          ?? ''
        ),
      requestedWeight: item.is_catch_weight ? '' : (String(item.unit || '').toLowerCase() === 'lb' ? String(asNumber(item.requested_weight) || '') : ''),
      unitPrice:       item.is_catch_weight ? '' : String(asNumber(item.unit_price) || ''),
      notes:           String(item.notes || ''),
      lotId:           String(item.lot_id || ''),
      isCatchWeight:   !!item.is_catch_weight,
      estimatedWeight: item.is_catch_weight ? String(asNumber(item.estimated_weight) || '') : '',
      pricePerLb:      item.is_catch_weight ? String(asNumber(item.price_per_lb) || '') : '',
    }));
    setRouteId(String(order.route_id || ''));
    setLines(draftLines.length ? draftLines : [emptyLine()]);
  }

  function buildPayload() {
    const validLines = lines.filter((line) => {
      if (!line.name.trim()) return false;
      if (line.isCatchWeight) return asNumber(line.estimatedWeight) > 0;
      if (line.unit === 'lb') return asNumber(line.requestedWeight) > 0;
      return asNumber(line.quantity) > 0;
    });

    const items = validLines.map((line) => {
      if (line.isCatchWeight) {
        return {
          name:             line.name.trim(),
          product_id:       normalizeText(line.productId) || undefined,
          item_number:      line.itemNumber.trim() || undefined,
          unit:             'lb' as const,
          is_catch_weight:  true,
          estimated_weight: asNumber(line.estimatedWeight),
          price_per_lb:     asNumber(line.pricePerLb),
          notes:            line.notes.trim() || undefined,
          lot_id:           normalizeText(line.lotId) || undefined,
        };
      }
      const qty = asNumber(line.quantity);
      const base = {
        name:        line.name.trim(),
        product_id:  normalizeText(line.productId) || undefined,
        item_number: line.itemNumber.trim() || undefined,
        unit:        line.unit,
        quantity:    qty,
        unit_price:  asNumber(line.unitPrice),
        notes:       line.notes.trim() || undefined,
        lot_id:      normalizeText(line.lotId) || undefined,
      };
      return line.unit === 'lb'
        ? { ...base, requested_qty: qty || undefined, requested_weight: asNumber(line.requestedWeight) }
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
      routeId: routeId || null,
    };
  }

  const ftlSet = useMemo(
    () => {
      const set = new Set<string>();
      for (const product of products) {
        if (!product.is_ftl_product) continue;
        const productId = normalizeText(product.id);
        const itemNumber = normalizeText(product.item_number);
        if (productId) set.add(productId);
        if (itemNumber) set.add(itemNumber);
      }
      return set;
    },
    [products]
  );

  const catchWeightSet = useMemo(
    () => {
      const set = new Set<string>();
      for (const product of products) {
        if (!product.is_catch_weight) continue;
        const productId = normalizeText(product.id);
        const itemNumber = normalizeText(product.item_number);
        if (productId) set.add(productId);
        if (itemNumber) set.add(itemNumber);
      }
      return set;
    },
    [products]
  );

  const defaultPriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) {
      if (p.is_catch_weight && p.default_price_per_lb != null) {
        const productId = normalizeText(p.id);
        const itemNumber = normalizeText(p.item_number);
        if (productId) map[productId] = asNumber(p.default_price_per_lb);
        if (itemNumber) map[itemNumber] = asNumber(p.default_price_per_lb);
      }
    }
    return map;
  }, [products]);

  return {
    editingOrderId,
    customerName, setCustomerName,
    customerEmail, setCustomerEmail,
    customerAddress, setCustomerAddress,
    fulfillmentType, setFulfillmentType,
    routeId, setRouteId,
    notes, setNotes,
    taxEnabled, setTaxEnabled,
    taxRate, setTaxRate,
    fuelPercent, setFuelPercent,
    servicePercent, setServicePercent,
    minimumFlat, setMinimumFlat,
    lines,
    subtotal, charges, draftTotal,
    ftlSet, catchWeightSet, defaultPriceMap,
    lotsCache,
    updateLine, toggleLineCatchWeight, addLine, removeLine,
    reset, populate, buildPayload,
  };
}
