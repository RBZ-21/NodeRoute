import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import type { Customer, InventoryProduct, LotCode, Order } from '../pages/orders.types';

export const orderKeys = {
  all: ['orders'] as const,
  list: (customerId?: string) => ['orders', customerId ?? ''] as const,
  drafts: ['orders', 'drafts'] as const,
};

export function useOrdersQuery(customerIdParam?: string) {
  return useQuery({
    queryKey: orderKeys.list(customerIdParam),
    queryFn: () => {
      const query = customerIdParam ? `?customerId=${encodeURIComponent(customerIdParam)}` : '';
      return fetchWithAuth<Order[]>(`/api/orders${query}`).then((d) => (Array.isArray(d) ? d : []));
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useCustomersQuery() {
  return useQuery({
    queryKey: ['customers'] as const,
    queryFn: () => fetchWithAuth<Customer[]>('/api/customers').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 10_000,
    retry: false,
  });
}

export function useInventoryQuery() {
  return useQuery({
    queryKey: ['inventory'] as const,
    queryFn: () =>
      fetchWithAuth<InventoryProduct[]>('/api/inventory').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 10_000,
    retry: false,
  });
}

// Lots are loaded lazily per line item — kept as local state since item numbers
// are dynamic form values, not a fixed list we can query up-front.
export function useLotsCache() {
  const [lotsCache, setLotsCache] = useState<Record<string, LotCode[]>>({});

  const loadLotsForProduct = useCallback(
    async (itemNumber: string) => {
      if (!itemNumber || lotsCache[itemNumber]) return;
      try {
        const data = await fetchWithAuth<LotCode[]>(
          `/api/lots?product_id=${encodeURIComponent(itemNumber)}&active_only=true`,
        );
        setLotsCache((prev) => ({ ...prev, [itemNumber]: Array.isArray(data) ? data : [] }));
      } catch {
        setLotsCache((prev) => ({ ...prev, [itemNumber]: [] }));
      }
    },
    [lotsCache],
  );

  return { lotsCache, loadLotsForProduct };
}

export function useSubmitOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ editingOrderId, payload }: { editingOrderId: string | null; payload: unknown }) => {
      if (editingOrderId) {
        return sendWithAuth<Order>(`/api/orders/${editingOrderId}`, 'PATCH', payload);
      }
      return sendWithAuth<Order>('/api/orders', 'POST', payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useSendOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      taxEnabled,
      taxRate,
    }: {
      orderId: string;
      taxEnabled: boolean;
      taxRate: number;
    }) => sendWithAuth<Order>(`/api/orders/${orderId}/send`, 'POST', { taxEnabled, taxRate }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useDeleteOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendWithAuth<unknown>(`/api/orders/${id}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useFulfillOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, items }: { orderId: string; items: Order['items'] }) =>
      sendWithAuth<{ emailSent?: boolean; emailError?: string | null }>(
        `/api/orders/${orderId}/fulfill`,
        'POST',
        { items: items ?? [], driverName: null, routeId: null },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useSaveWeightMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      itemIndex,
      actualWeight,
    }: {
      orderId: string;
      itemIndex: number;
      actualWeight: number;
    }) =>
      sendWithAuth<Order>(
        `/api/orders/${orderId}/items/${itemIndex}/actual-weight`,
        'PATCH',
        { actual_weight: actualWeight },
      ),
    onSuccess: (updatedOrder) => {
      // Patch the order in every cached orders list without a full refetch.
      queryClient.setQueriesData<Order[]>({ queryKey: orderKeys.all }, (old) =>
        old?.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)) ?? old,
      );
    },
  });
}

export function useSmsDraftsQuery() {
  return useQuery({
    queryKey: orderKeys.drafts,
    queryFn: () =>
      fetchWithAuth<Order[]>('/api/orders').then((d) =>
        (Array.isArray(d) ? d : []).filter((o) => o.draft === true),
      ),
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: false,
  });
}

export function useApproveDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      sendWithAuth<Order>(`/api/orders/${orderId}/approve-draft`, 'PATCH', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useDiscardDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      sendWithAuth<{ deleted: boolean }>(`/api/orders/${orderId}/draft`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

