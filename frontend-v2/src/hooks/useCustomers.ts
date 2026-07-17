import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListWithAuth, fetchWithAuth, sendWithAuth } from '../lib/api';
import type { Order } from '../pages/orders.types';

export type Customer = {
  id?: number | string;
  customer_number?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  status?: string;
  contact_name?: string;
  payment_terms?: string;
  address?: string;
  billing_name?: string;
  billing_contact?: string;
  billing_email?: string;
  billing_phone?: string;
  billing_address?: string;
  tax_enabled?: boolean;
  sms_notifications_enabled?: boolean;
  credit_hold?: boolean;
  credit_hold_reason?: string;
  credit_hold_placed_at?: string;
  fax_number?: string;
  delivery_notes?: string;
  preferred_delivery_window?: string;
  preferred_door?: string;
};

export type CustomerInvoice = {
  id?: number | string;
  invoice_number?: string;
  invoiceNumber?: string;
  status?: string;
  total?: number | string;
  created_at?: string;
  createdAt?: string;
  due_date?: string;
  dueDate?: string;
};

export function useCustomersQuery() {
  return useQuery({
    queryKey: ['customers'] as const,
    queryFn: () =>
      fetchListWithAuth<Customer>('/api/customers'),
    staleTime: 30_000,
  });
}

// Only fetches when a customerId is provided — pass null to disable (e.g. when
// the invoices tab is not active).
export function useCustomerInvoicesQuery(customerId: number | string | null | undefined) {
  return useQuery({
    queryKey: ['invoices', 'customer', customerId] as const,
    queryFn: () =>
      fetchListWithAuth<CustomerInvoice>(`/api/invoices?customer_id=${customerId}`),
    enabled: customerId != null,
    staleTime: 30_000,
  });
}

// A single frequently-ordered line, as aggregated server-side from this
// customer's order history over the trailing 90-day window.
export type FrequentlyOrderedItem = {
  product_id?: string | null;
  item_number?: string | null;
  description: string;
  order_count: number;
  total_quantity: number;
  last_ordered_at?: string | null;
};

export type FrequentlyOrderedResponse = {
  items: FrequentlyOrderedItem[];
  window_start: string;
};

// Only fetches when a customerId is provided — pass null to disable (e.g. when
// the order-history tab is not active). Mirrors useCustomerInvoicesQuery.
export function useCustomerOrderHistoryQuery(customerId: number | string | null | undefined) {
  return useQuery({
    queryKey: ['orders', 'customer', customerId] as const,
    queryFn: () =>
      fetchListWithAuth<Order>(`/api/customers/${customerId}/orders`),
    enabled: customerId != null,
    staleTime: 30_000,
  });
}

// Only fetches when a customerId is provided — pass null to disable (e.g. when
// the frequently-ordered tab is not active).
export function useCustomerFrequentlyOrderedQuery(customerId: number | string | null | undefined) {
  return useQuery({
    queryKey: ['frequently-ordered', 'customer', customerId] as const,
    queryFn: () => fetchWithAuth<FrequentlyOrderedResponse>(`/api/customers/${customerId}/frequently-ordered`),
    enabled: customerId != null,
    staleTime: 30_000,
  });
}

export function useSaveCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: number | string; draft: unknown }) =>
      sendWithAuth<Customer>(`/api/customers/${id}`, 'PATCH', draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useDeleteCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number | string) => sendWithAuth(`/api/customers/${id}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}
