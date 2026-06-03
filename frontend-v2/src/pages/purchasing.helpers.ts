import type { ChangeEvent, RefObject } from 'react';
import type { PoScanResult, VendorPurchaseOrder } from '../hooks/usePurchasing';
import type { Vendor } from '../hooks/useVendors';

/**
 * Shared file-input change handler for the PO/receipt scanners: grabs the
 * selected file, clears the input (so re-selecting the same file re-fires),
 * and hands it to the provided async handler.
 */
export function handleFileInputChange(
  e: ChangeEvent<HTMLInputElement>,
  ref: RefObject<HTMLInputElement>,
  onFile: (file: File) => Promise<void> | void,
) {
  const file = e.target.files?.[0];
  if (ref.current) ref.current.value = '';
  if (file) void onFile(file);
}

export type PurchaseItemDraft = {
  description: string;
  item_number: string;
  quantity: string;
  unit_price: string;
  unit: string;
  category: string;
  lot_number: string;
  expiration_date: string;
  count_item_approved: boolean;
};

export type VendorDraft = Pick<Vendor, 'name' | 'contact' | 'email' | 'phone' | 'address' | 'payment_terms' | 'status'>;

export type ReceiveLineDraft = {
  line_no: number;
  qty_received: string;
  unit_cost: string;
  lot_number: string;
};

export type ReceivePoLine = NonNullable<VendorPurchaseOrder['lines']>[number];

export type ReceiveScanApplySummary = {
  mappedCount: number;
  unmatchedItems: string[];
};

export type ReceiptDiscrepancyEntry = {
  id: string;
  poNumber: string;
  vendor: string;
  receivedAt: string;
  lineLabel: string;
  varianceLabel: string;
  quantityVariance: number;
  overReceiptQty: number;
};

export type LeadTimeInsights = {
  measuredCount: number;
  vendorCount: number;
  averageDays: number;
  medianDays: number;
  latestDays: number | null;
};

export type VendorLeadTimeHistory = {
  vendor: string;
  receiptCount: number;
  averageDays: number;
  latestDays: number | null;
};

export type ProductLeadTimeHistory = VendorLeadTimeHistory & {
  productLabel: string;
};

export function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
export function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatLeadTimeDays(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? `${asNumber(value).toFixed(2)} d` : 'Not measured';
}

export function remainingQty(line: { ordered_qty?: number | string; received_qty?: number | string; backordered_qty?: number | string; waived_backorder_qty?: number | string }) {
  const backordered = asNumber(line.backordered_qty);
  const waived = asNumber(line.waived_backorder_qty);
  if (waived > 0) return Math.max(0, backordered);
  const ordered = asNumber(line.ordered_qty);
  const receivedTowardOrdered = Math.min(asNumber(line.received_qty), ordered);
  return Math.max(0, ordered - receivedTowardOrdered);
}

export function lineRequiresLot(line: { description?: string; product_name?: string; category?: string | null }) {
  return /\b(mussel|clam|oyster)s?\b/i.test(`${line.description || line.product_name || ''} ${line.category || ''}`);
}

export function normalizeScanText(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeVendorName(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeCatalogItemNumber(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function vendorCatalogItemNumbers(vendorRecord: { catalog_item_numbers?: string[] } | null | undefined) {
  if (!Array.isArray(vendorRecord?.catalog_item_numbers)) return [];
  return Array.from(
    new Set(
      vendorRecord.catalog_item_numbers
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  );
}

export type VendorOption = { label: string; value: string; sublabel?: string };

/**
 * Vendor dropdown options merged from saved vendor master records and any
 * vendor names that only appear on historical purchase orders. Shared by the
 * create-PO combobox and the purchasing-history vendor filter.
 */
export function buildVendorOptions(orders: { vendor?: string }[], vendorRecords: Vendor[]): VendorOption[] {
  const byKey = new Map<string, VendorOption>();
  for (const vendorRecord of vendorRecords) {
    const label = String(vendorRecord.name || '').trim();
    const key = normalizeVendorName(label);
    if (!key) continue;
    const catalogCount = vendorCatalogItemNumbers(vendorRecord).length;
    const category = String(vendorRecord.category || '').trim();
    const summaryParts = [
      category || null,
      catalogCount ? `${catalogCount} catalog SKU${catalogCount === 1 ? '' : 's'}` : 'all inventory',
    ].filter(Boolean);
    byKey.set(key, {
      label,
      value: label,
      sublabel: summaryParts.join(' · ') || undefined,
    });
  }
  for (const order of orders) {
    const label = String(order.vendor || '').trim();
    const key = normalizeVendorName(label);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { label, value: label });
  }
  return Array.from(byKey.values()).sort((left, right) => left.label.localeCompare(right.label));
}

export function buildScannedVendorDraft(result: PoScanResult): VendorDraft | null {
  const details = result.vendor_details || {};
  const name = String(details.name || result.vendor || '').trim();
  if (!name) return null;
  return {
    name,
    contact: String(details.contact || '').trim(),
    email: String(details.email || '').trim(),
    phone: String(details.phone || '').trim(),
    address: String(details.address || '').trim(),
    payment_terms: String(details.payment_terms || '').trim(),
    status: 'active',
  };
}

export function buildLeadTimeProductKey(itemNumber: unknown, description: unknown) {
  const normalizedItemNumber = String(itemNumber || '').trim().toLowerCase();
  if (normalizedItemNumber) return `item:${normalizedItemNumber}`;
  const normalizedDescription = normalizeScanText(description);
  return normalizedDescription ? `desc:${normalizedDescription}` : '';
}

export function buildLeadTimeHistoryLookups(orders: VendorPurchaseOrder[]) {
  const vendorBuckets = new Map<string, { vendor: string; values: number[]; latestDays: number | null; latestAt: string }>();
  const productBuckets = new Map<string, { vendor: string; productLabel: string; values: number[]; latestDays: number | null; latestAt: string }>();

  for (const po of orders) {
    const leadTimeDays = asNumber(po.first_receipt_lead_time_days);
    const vendorName = String(po.vendor || po.vendor_name || '').trim();
    const vendorKey = vendorName.toLowerCase();
    if (!vendorKey || leadTimeDays <= 0) continue;

    const receivedAt = String(po.first_received_at || po.latest_received_at || po.created_at || '');
    const vendorBucket = vendorBuckets.get(vendorKey) || {
      vendor: vendorName,
      values: [],
      latestDays: null,
      latestAt: '',
    };
    vendorBucket.values.push(leadTimeDays);
    if (receivedAt && receivedAt >= vendorBucket.latestAt) {
      vendorBucket.latestAt = receivedAt;
      vendorBucket.latestDays = leadTimeDays;
    }
    vendorBuckets.set(vendorKey, vendorBucket);

    for (const line of po.lines || []) {
      const lineLeadTimeDays = asNumber(line.first_receipt_lead_time_days);
      const productKey = buildLeadTimeProductKey(line.item_number, line.product_name || line.product_id);
      if (!productKey || lineLeadTimeDays <= 0) continue;
      const bucketKey = `${vendorKey}::${productKey}`;
      const lineReceivedAt = String(line.first_received_at || line.latest_received_at || receivedAt);
      const productBucket = productBuckets.get(bucketKey) || {
        vendor: vendorName,
        productLabel: String(line.product_name || line.item_number || 'Product').trim() || 'Product',
        values: [],
        latestDays: null,
        latestAt: '',
      };
      productBucket.values.push(lineLeadTimeDays);
      if (lineReceivedAt && lineReceivedAt >= productBucket.latestAt) {
        productBucket.latestAt = lineReceivedAt;
        productBucket.latestDays = lineLeadTimeDays;
      }
      productBuckets.set(bucketKey, productBucket);
    }
  }

  const vendorHistory = new Map<string, VendorLeadTimeHistory>();
  for (const [key, bucket] of vendorBuckets.entries()) {
    vendorHistory.set(key, {
      vendor: bucket.vendor,
      receiptCount: bucket.values.length,
      averageDays: bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length,
      latestDays: bucket.latestDays,
    });
  }

  const productHistory = new Map<string, ProductLeadTimeHistory>();
  for (const [key, bucket] of productBuckets.entries()) {
    productHistory.set(key, {
      vendor: bucket.vendor,
      productLabel: bucket.productLabel,
      receiptCount: bucket.values.length,
      averageDays: bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length,
      latestDays: bucket.latestDays,
    });
  }

  return { vendorHistory, productHistory };
}

export function resolveProductLeadTimeHistory(line: PurchaseItemDraft, vendorName: string, history: Map<string, ProductLeadTimeHistory>) {
  const vendorKey = String(vendorName || '').trim().toLowerCase();
  if (!vendorKey) return null;

  const itemKey = buildLeadTimeProductKey(line.item_number, null);
  if (itemKey) {
    const match = history.get(`${vendorKey}::${itemKey}`);
    if (match) return match;
  }

  const descriptionKey = buildLeadTimeProductKey(null, line.description);
  if (descriptionKey) {
    return history.get(`${vendorKey}::${descriptionKey}`) || null;
  }

  return null;
}

export function buildReceiveDraft(line: ReceivePoLine): ReceiveLineDraft {
  return {
    line_no: line.line_no,
    qty_received: remainingQty(line) > 0 ? String(remainingQty(line)) : '',
    unit_cost: asNumber(line.unit_cost) > 0 ? String(asNumber(line.unit_cost)) : '',
    lot_number: String(line.lot_number || '').trim(),
  };
}

export function scoreReceiveScanMatch(line: ReceivePoLine, item: PoScanResult['items'][number]) {
  const lineLabel = normalizeScanText(line.product_name || line.item_number);
  const itemLabel = normalizeScanText(item.description);
  if (!lineLabel || !itemLabel) return 0;

  let score = 0;
  if (lineLabel === itemLabel) score += 100;
  if (line.item_number && normalizeScanText(line.item_number) === itemLabel) score += 80;
  if (lineLabel.includes(itemLabel) || itemLabel.includes(lineLabel)) score += 60;

  const lineTokens = new Set(lineLabel.split(' ').filter(Boolean));
  for (const token of itemLabel.split(' ').filter(Boolean)) {
    if (lineTokens.has(token)) score += 15;
  }

  if (item.quantity != null) {
    score += Math.max(0, 10 - Math.abs(asNumber(item.quantity) - remainingQty(line)));
  }
  if (item.lot_number && lineRequiresLot(line)) score += 5;
  return score;
}

export function findReceiveScanMatchIndex(poLines: ReceivePoLine[], item: PoScanResult['items'][number], usedIndexes: Set<number>) {
  let bestIndex = -1;
  let bestScore = 0;
  poLines.forEach((line, index) => {
    if (usedIndexes.has(index)) return;
    const score = scoreReceiveScanMatch(line, item);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestScore >= 25 ? bestIndex : -1;
}

export function statusTone(status: string | undefined): 'success' | 'warning' | 'secondary' | 'neutral' {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'received') return 'success';
  if (normalized === 'backordered') return 'warning';
  if (normalized === 'partial_received') return 'secondary';
  return 'neutral';
}

export const emptyLine = (): PurchaseItemDraft => ({
  description: '', item_number: '', quantity: '', unit_price: '',
  unit: 'lb', category: 'Other', lot_number: '', expiration_date: '',
  count_item_approved: false,
});
