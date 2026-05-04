import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

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

export function useSalesRepCustomers() {
  return useQuery({
    queryKey: ['salesrep-customers'],
    queryFn: () => fetchWithAuth<Customer[]>('/api/sales-reps/customers'),
    select: (data) => (Array.isArray(data) ? data : []),
  });
}

export function useVisitLogs() {
  return useQuery({
    queryKey: ['salesrep-visits'],
    queryFn: () => fetchWithAuth<VisitLog[]>('/api/sales-reps/visit-logs'),
    select: (data) => (Array.isArray(data) ? data : []),
  });
}

export function useUpsellAlerts() {
  return useQuery({
    queryKey: ['salesrep-upsell'],
    queryFn: () => fetchWithAuth<UpsellAlert[]>('/api/sales-reps/upsell-alerts'),
    select: (data) => (Array.isArray(data) ? data : []),
  });
}

export function useOrderHistory(customerId: string | number | null) {
  return useQuery({
    queryKey: ['salesrep-order-history', customerId],
    queryFn: () => fetchWithAuth<Order[]>(`/api/sales-reps/order-history/${customerId}`),
    enabled: customerId !== null,
    select: (data) => (Array.isArray(data) ? data : []),
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
