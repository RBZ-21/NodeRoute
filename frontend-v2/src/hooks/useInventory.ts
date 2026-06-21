import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import type { InventoryItem, InventoryLotSummary, LedgerResponse, LowStockItem, RecentSoldItemsResponse } from '../types/inventory.types';

export type LedgerParams = {
  itemFilter: string;
  typeFilter: string;
  limit: string;
};

export function useInventoryQuery() {
  return useQuery({
    queryKey: ['inventory'] as const,
    queryFn: () =>
      fetchWithAuth<InventoryItem[]>('/api/inventory').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 30_000,
  });
}

export function useActiveInventoryLotsQuery() {
  return useQuery({
    queryKey: ['inventory', 'active-lots'] as const,
    queryFn: () =>
      fetchWithAuth<InventoryLotSummary[]>('/api/lots?active_only=true').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 30_000,
  });
}

export function useLedgerQuery(params: LedgerParams) {
  return useQuery({
    queryKey: ['inventory', 'ledger', params.itemFilter, params.typeFilter, params.limit] as const,
    queryFn: () => {
      const p = new URLSearchParams();
      if (params.itemFilter) p.set('item_number', params.itemFilter);
      if (params.typeFilter) p.set('change_type', params.typeFilter);
      p.set('limit', String(Math.max(1, Math.min(500, Number(params.limit) || 75))));
      return fetchWithAuth<LedgerResponse>(`/api/inventory/ledger?${p.toString()}`);
    },
    staleTime: 30_000,
  });
}

// Pass null to disable (when "All" is selected in the sales exclusion window).
export function useRecentSoldQuery(days: '30' | '60' | '90' | null) {
  return useQuery({
    queryKey: ['inventory', 'recent-sold', days] as const,
    queryFn: () =>
      fetchWithAuth<RecentSoldItemsResponse>(`/api/reporting/recent-sold-items?days=${days}`).then(
        (data) =>
          new Set(
            (Array.isArray(data.items) ? data.items : [])
              .map((i) => String(i.key || '').trim().toLowerCase())
              .filter(Boolean),
          ),
      ),
    enabled: days !== null,
    staleTime: 30_000,
  });
}

export function useRestockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemNumber, qty, notes }: { itemNumber: string; qty: number; notes?: string }) =>
      sendWithAuth<unknown>(
        `/api/inventory/${encodeURIComponent(itemNumber)}/restock`,
        'POST',
        { qty, notes },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useAdjustMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemNumber, delta, notes }: { itemNumber: string; delta: number; notes?: string }) =>
      sendWithAuth<unknown>(
        `/api/inventory/${encodeURIComponent(itemNumber)}/adjust`,
        'POST',
        { delta, notes },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useTransferMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      fromItem,
      toItem,
      qty,
      notes,
    }: {
      fromItem: string;
      toItem: string;
      qty: number;
      notes?: string;
    }) =>
      sendWithAuth<{ transfer_ref?: string }>('/api/inventory/transfer', 'POST', {
        from_item_number: fromItem,
        to_item_number: toItem,
        qty,
        notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useEditInventoryItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemNumber, patch }: {
      itemNumber: string;
      patch: Partial<{
        item_number: string;
        description: string;
        description_line_1: string;
        category: string;
        class_name: string;
        unit: string;
        cost: number;
        base_cost: number;
        cost_base: number;
        landed_cost: number;
        lot_cost: number;
        market_cost: number;
        real_cost: number;
        cost_real: number;
        allocated_quantity: number;
        on_hand_qty: number;
        on_hand_quantity: number;
        on_hand_weight: number;
        value_at_cost: number;
        value_at_level_1: number;
        reorder_point: number | null;
        barcode: string | null;
        notes: string | null;
      }>;
    }) => sendWithAuth<InventoryItem>(`/api/inventory/${encodeURIComponent(itemNumber)}`, 'PATCH', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useAddInventoryItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: {
      item_number: string;
      description: string;
      description_line_1?: string;
      category?: string;
      class_name?: string;
      unit?: string;
      cost?: number;
      base_cost?: number;
      cost_base?: number;
      real_cost?: number;
      cost_real?: number;
      allocated_quantity?: number;
      on_hand_qty: number;
      on_hand_quantity?: number;
      on_hand_weight?: number;
      value_at_cost?: number;
      value_at_level_1?: number;
      reorder_point?: number | null;
      barcode?: string | null;
    }) => sendWithAuth<InventoryItem>('/api/inventory', 'POST', item),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useLowStockQuery(enabled = true) {
  return useQuery({
    queryKey: ['inventory', 'low-stock'] as const,
    queryFn: () =>
      fetchWithAuth<LowStockItem[]>('/api/inventory/low-stock').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 60_000,
    enabled,
  });
}

export function useSetReorderPointMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemNumber, reorderPoint }: { itemNumber: string; reorderPoint: number | null }) =>
      sendWithAuth<InventoryItem>(
        `/api/inventory/${encodeURIComponent(itemNumber)}`,
        'PATCH',
        { reorder_point: reorderPoint },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useSpoilageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemNumber,
      qty,
      reason,
      notes,
    }: {
      itemNumber: string;
      qty: number;
      reason?: string;
      notes?: string;
    }) =>
      sendWithAuth<unknown>(
        `/api/inventory/${encodeURIComponent(itemNumber)}/spoilage`,
        'POST',
        { qty, reason, notes },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
