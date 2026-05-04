import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type PurchaseOrder = {
  id: string;
  po_number?: string;
  vendor?: string;
  total_cost?: number | string;
  confirmed_by?: string;
  created_at?: string;
  items?: unknown[];
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

export function useConfirmPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConfirmPoPayload) =>
      sendWithAuth<{ errors?: string[]; lots_created?: number }>(
        '/api/purchase-orders/confirm',
        'POST',
        payload
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
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
