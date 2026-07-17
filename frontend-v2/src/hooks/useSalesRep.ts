import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListWithAuth, sendWithAuth } from '../lib/api';

export type Customer = {
  id: string | number;
  company_name?: string;
  email?: string;
  phone_number?: string;
  address?: string;
  payment_terms?: string;
  sales_rep_id?: string;
};

export type VisitLog = {
  id: string;
  customer_name?: string;
  sales_rep_name?: string;
  notes?: string;
  outcome?: string;
  visited_at?: string;
};

export type UpsellAlert = {
  customer_id: string | number;
  customer_name?: string;
  missing_items: string[];
  alert: string;
};

export type Order = {
  id: string;
  created_at?: string;
  status?: string;
  total?: number | string;
  items?: { description?: string; quantity?: number; total?: number }[];
};

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeUpsellAlert(alert: UpsellAlert): UpsellAlert {
  return {
    ...alert,
    missing_items: stringArray(alert.missing_items),
    alert: String(alert.alert || ''),
  };
}

function normalizeOrder(order: Order): Order {
  return {
    ...order,
    items: Array.isArray(order.items)
      ? order.items.filter((item): item is NonNullable<Order['items']>[number] => !!item && typeof item === 'object')
      : [],
  };
}

export function useSalesRepCustomers() {
  return useQuery({
    queryKey: ['salesrep-customers'],
    queryFn: () => fetchListWithAuth<Customer>('/api/sales-reps/customers'),
    staleTime: 30_000,
  });
}

export function useVisitLogs() {
  return useQuery({
    queryKey: ['salesrep-visits'],
    queryFn: () => fetchListWithAuth<VisitLog>('/api/sales-reps/visit-logs'),
    staleTime: 30_000,
  });
}

export function useUpsellAlerts() {
  return useQuery({
    queryKey: ['salesrep-upsell'],
    queryFn: () => fetchListWithAuth<UpsellAlert>('/api/sales-reps/upsell-alerts'),
    select: (data) => data.map(normalizeUpsellAlert),
    staleTime: 30_000,
  });
}

export function useOrderHistory(customerId: string | number | null) {
  return useQuery({
    queryKey: ['salesrep-order-history', customerId],
    queryFn: () => fetchListWithAuth<Order>(`/api/sales-reps/order-history/${customerId}`),
    enabled: customerId !== null,
    select: (data) => data.map(normalizeOrder),
    staleTime: 30_000,
  });
}

export function useLogVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { customer_id: string; customer_name?: string; notes?: string; outcome?: string }) =>
      sendWithAuth('/api/sales-reps/visit-logs', 'POST', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salesrep-visits'] }),
  });
}
