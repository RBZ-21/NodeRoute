// Shared types and pure helpers for the Orders feature.

export type OrderStatus = 'pending' | 'in_process' | 'invoiced' | 'cancelled' | 'unknown';

export type OrderItem = {
  name?: string;
  description?: string;
  item_number?: string;
  unit?: string;
  requested_qty?: number | string;
  requested_weight?: number | string;
  actual_weight?: number | string;
  quantity?: number | string;
  unit_price?: number | string;
  notes?: string;
  lot_id?: number | string;
  lot_number?: string;
  quantity_from_lot?: number | string;
  is_catch_weight?: boolean;
  estimated_weight?: number | string;
  price_per_lb?: number | string;
  estimated_total?: number | string;
  actual_total?: number | string;
  weight_variance?: number | null;
  weight_confirmed?: boolean;
};

export type OrderCharge = {
  key?: string;
  label?: string;
  type?: string;
  value?: number | string;
  amount?: number | string;
};

export type Order = {
  id: string;
  customer_id?: string;
  customerId?: string;
  order_number?: string;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  fulfillment_type?: 'delivery' | 'pickup' | string;
  status?: string;
  notes?: string;
  tax_enabled?: boolean;
  tax_rate?: number | string;
  created_at?: string;
  items?: OrderItem[];
  charges?: OrderCharge[];
};

export type Customer = {
  id: string;
  company_name?: string;
  billing_email?: string;
  address?: string;
  billing_address?: string;
  customer_address?: string;
  delivery_address?: string;
  shipping_address?: string;
  ship_to_address?: string;
  phone_number?: string;
};

export type InventoryProduct = {
  item_number: string;
  description: string;
  is_ftl_product?: boolean;
  is_catch_weight?: boolean;
  default_price_per_lb?: number | string;
  unit?: string;
  cost?: number | string;
};

export type LotCode = {
  id: number;
  lot_number: string;
  product_id?: string;
  quantity_received?: number;
  unit_of_measure?: string;
  expiration_date?: string | null;
};

export type OrderLineDraft = {
  name: string;
  itemNumber: string;
  unit: 'lb' | 'each';
  quantity: string;
  requestedWeight: string;
  unitPrice: string;
  notes: string;
  lotId: string;
  isCatchWeight: boolean;
  estimatedWeight: string;
  pricePerLb: string;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function emptyLine(): OrderLineDraft {
  return { name: '', itemNumber: '', unit: 'lb', quantity: '', requestedWeight: '', unitPrice: '', notes: '', lotId: '', isCatchWeight: false, estimatedWeight: '', pricePerLb: '' };
}

export function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function orderItemQty(item: OrderItem): number {
  if (item.is_catch_weight) {
    const aw = asNumber(item.actual_weight);
    return aw > 0 ? aw : asNumber(item.estimated_weight);
  }
  if (String(item.unit || '').toLowerCase() === 'lb') {
    const aw = asNumber(item.actual_weight);
    return aw > 0 ? aw : asNumber(item.requested_weight ?? item.quantity ?? 0);
  }
  return asNumber(item.requested_qty ?? item.quantity ?? item.requested_weight ?? 0);
}

export function isWeightManagedItem(item: OrderItem): boolean {
  return !!item.is_catch_weight || String(item.unit || '').toLowerCase() === 'lb' || item.requested_weight !== undefined;
}

export function hasPendingWeight(item: OrderItem): boolean {
  if (!isWeightManagedItem(item)) return false;
  return !(asNumber(item.actual_weight) > 0);
}

export function orderWeightManagedItems(order: Order): OrderItem[] {
  return (order.items || []).filter((item) => isWeightManagedItem(item));
}

export function orderHasPendingWeights(order: Order): boolean {
  return orderWeightManagedItems(order).some((item) => hasPendingWeight(item));
}

export function orderHasCapturedWeights(order: Order): boolean {
  const managedItems = orderWeightManagedItems(order);
  return managedItems.length > 0 && managedItems.every((item) => !hasPendingWeight(item));
}

export function isOpenOrderStatus(status: string | undefined): boolean {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'pending' || normalized === 'in_process' || normalized === 'processed';
}

export function calcOrderTotal(order: Order): number {
  const itemTotal = (order.items || []).reduce((sum, item) => {
    if (item.is_catch_weight) return sum + orderItemQty(item) * asNumber(item.price_per_lb);
    return sum + orderItemQty(item) * asNumber(item.unit_price);
  }, 0);
  const chargeTotal = (order.charges || []).reduce((sum, charge) => sum + asNumber(charge.amount), 0);
  return itemTotal + chargeTotal;
}

export function normalizedStatus(value: string | undefined): OrderStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'pending' || status === 'in_process' || status === 'invoiced' || status === 'cancelled') return status;
  return 'unknown';
}

export function statusVariant(status: OrderStatus): 'warning' | 'secondary' | 'success' | 'neutral' {
  if (status === 'pending')    return 'warning';
  if (status === 'in_process') return 'secondary';
  if (status === 'invoiced')   return 'success';
  return 'neutral';
}

export function draftSubtotal(lines: OrderLineDraft[]): number {
  return lines.reduce((sum, line) => {
    if (line.isCatchWeight) return sum + asNumber(line.estimatedWeight) * asNumber(line.pricePerLb);
    const basis = line.unit === 'lb' ? asNumber(line.requestedWeight) : asNumber(line.quantity);
    return sum + basis * asNumber(line.unitPrice);
  }, 0);
}

export function orderCustomerId(order: Order): string {
  return String(order.customer_id || order.customerId || '');
}

export function fmtDate(value: unknown): string {
  if (!value) return '';
  try { return new Date(String(value)).toLocaleDateString(); } catch { return String(value); }
}
