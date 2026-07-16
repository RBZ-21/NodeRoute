import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListWithAuth, sendWithAuth } from '../lib/api';

export type RecurringOrderItem = {
  item_number?: string | null;
  name?: string | null;
  unit?: string;
  quantity?: number;
  unit_price?: number;
};

export type RecurringOrder = {
  id: string;
  customer_id?: string | null;
  customer_name?: string;
  customer_email?: string | null;
  customer_address?: string | null;
  schedule_days: number[];
  items: RecurringOrderItem[];
  route_template_id?: string | null;
  notes?: string | null;
  active: boolean;
  next_run_date?: string | null;
  last_generated_at?: string | null;
};

const KEY = ['recurring-orders'];

export function useRecurringOrders() {
  return useQuery<RecurringOrder[]>({
    queryKey: KEY,
    queryFn: () => fetchListWithAuth<RecurringOrder>('/api/recurring-orders'),
    staleTime: 30_000,
  });
}

export function useSaveRecurringOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<RecurringOrder> }) =>
      id
        ? sendWithAuth<RecurringOrder>(`/api/recurring-orders/${id}`, 'PATCH', body)
        : sendWithAuth<RecurringOrder>('/api/recurring-orders', 'POST', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteRecurringOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendWithAuth(`/api/recurring-orders/${id}`, 'DELETE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
