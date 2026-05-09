import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type PurchaseOrder = {
  id: string;
  po_number?: string;
  vendor?: string;
  notes?: string | null;
  total_cost?: number | string;
  confirmed_by?: string;
  created_at?: string;
  items?: unknown[];
};

export type VendorPoReceiptRules = {
  over_receipt_policy?: 'reject' | 'cap' | 'allow' | string;
  backorder_policy?: 'open' | 'waive' | string;
};

export type VendorPoLine = {
  line_no: number;
  product_id?: string | null;
  item_number?: string | null;
  product_name?: string;
  unit?: string;
  ordered_qty?: number | string;
  received_qty?: number | string;
  over_received_qty?: number | string;
  backordered_qty?: number | string;
  waived_backorder_qty?: number | string;
  unit_cost?: number | string;
  line_total?: number | string;
  received_total?: number | string;
};

export type VendorPoReceiptLine = {
  line_no: number;
  item_number?: string | null;
  product_name?: string;
  qty_received?: number | string;
  requested_receive_qty?: number | string;
  accepted_receive_qty?: number | string;
  rejected_receive_qty?: number | string;
  over_receipt_qty?: number | string;
  remaining_before_qty?: number | string;
  remaining_after_qty?: number | string;
  quantity_variance_qty?: number | string;
  variance_type?: string;
  backordered_qty_after_receipt?: number | string;
  waived_backorder_qty_applied?: number | string;
  unit?: string;
  unit_cost?: number | string;
};

export type VendorPoReceipt = {
  id: string;
  received_at?: string;
  received_by?: string;
  notes?: string | null;
  variance_audit?: {
    total_requested_qty?: number | string;
    total_accepted_qty?: number | string;
    total_rejected_qty?: number | string;
    total_over_receipt_qty?: number | string;
    total_backordered_qty_after_receipt?: number | string;
    line_count_requested?: number | string;
    line_count_applied?: number | string;
  };
  lines?: VendorPoReceiptLine[];
};

export type VendorPoLeadTimeHistory = {
  vendor?: string;
  receipt_count?: number;
  average_days?: number | null;
  median_days?: number | null;
  minimum_days?: number | null;
  maximum_days?: number | null;
  latest_days?: number | null;
};

export type VendorPurchaseOrder = {
  id: string;
  po_number?: string;
  vendor_name?: string;
  vendor?: string;
  status?: string;
  notes?: string | null;
  expected_date?: string | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  line_count?: number | string;
  total_ordered_qty?: number | string;
  total_received_qty?: number | string;
  total_backordered_qty?: number | string;
  total_ordered_cost?: number | string;
  total_received_cost?: number | string;
  first_received_at?: string | null;
  latest_received_at?: string | null;
  first_receipt_lead_time_days?: number | null;
  first_receipt_lead_time_hours?: number | null;
  full_receipt_lead_time_days?: number | null;
  lead_time_history?: VendorPoLeadTimeHistory | null;
  receipt_rules?: VendorPoReceiptRules;
  lines?: VendorPoLine[];
  receipts?: VendorPoReceipt[];
};

export type InventoryProduct = {
  item_number: string;
  description: string;
  unit?: string;
  cost?: number | string;
  category?: string;
};

export type ScannedLineItem = {
  description: string | null;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total: number | null;
  item_type: 'weighted' | 'count' | 'unknown';
  lot_number: string | null;
  lot_number_confidence: 'none' | 'low' | 'medium' | 'high';
};

export type PoScanResult = {
  vendor: string | null;
  po_number: string | null;
  date: string | null;
  total_cost: number | null;
  items: ScannedLineItem[];
};

export type ConfirmPoPayload = {
  vendor: string | null;
  po_number: string | null;
  notes: string | null;
  total_cost: number;
  items: {
    description: string;
    item_number?: string;
    quantity: number;
    unit_price: number;
    unit: string;
    category: string;
    lot_number?: string;
    expiration_date?: string;
    total: number;
  }[];
};

export type ConfirmPoResponse = {
  success?: boolean;
  errors?: string[];
  lots_created?: number;
  purchase_order?: PurchaseOrder | null;
};

export type ReceiveVendorPoPayload = {
  lines: {
    line_no: number;
    qty_received: number;
    unit_cost?: number;
    item_number?: string;
    product_name?: string;
  }[];
  notes?: string | null;
  receiptRules?: VendorPoReceiptRules;
};

export function usePurchaseOrders(vendorParam?: string) {
  return useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', vendorParam ?? ''],
    queryFn: () => {
      const query = vendorParam ? `?vendor=${encodeURIComponent(vendorParam)}` : '';
      return fetchWithAuth<PurchaseOrder[]>(`/api/purchase-orders${query}`).then((d) =>
        Array.isArray(d) ? d : []
      );
    },
    staleTime: 30_000,
  });
}

export function useInventoryProducts() {
  return useQuery<InventoryProduct[]>({
    queryKey: ['inventory-products'],
    queryFn: () =>
      fetchWithAuth<InventoryProduct[]>('/api/inventory').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 60_000,
  });
}

export function useVendorPurchaseOrders() {
  return useQuery<VendorPurchaseOrder[]>({
    queryKey: ['vendor-purchase-orders'],
    queryFn: () =>
      fetchWithAuth<VendorPurchaseOrder[]>('/api/ops/vendor-purchase-orders').then((d) =>
        Array.isArray(d) ? d : []
      ),
    staleTime: 30_000,
  });
}

export function useConfirmPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConfirmPoPayload) =>
      sendWithAuth<ConfirmPoResponse>(
        '/api/purchase-orders/confirm',
        'POST',
        payload
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

export function useReceiveVendorPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReceiveVendorPoPayload }) =>
      sendWithAuth<VendorPurchaseOrder>(`/api/ops/vendor-purchase-orders/${id}/receive`, 'POST', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-products'] });
    },
  });
}

export async function scanPoFile(file: File): Promise<PoScanResult> {
  const formData = new FormData();
  formData.append('file', file);
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  const res = await fetch('/api/ai/scan-po', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(String(err.error || res.statusText));
  }
  return res.json();
}

export function openPurchaseOrderPdf(orderId: string) {
  return window.open(`/api/purchase-orders/${orderId}/pdf`, '_blank', 'noopener,noreferrer');
}
