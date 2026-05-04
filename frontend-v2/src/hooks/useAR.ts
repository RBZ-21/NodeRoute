import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type AgingRow = {
  customer_name: string;
  customer_email: string | null;
  buckets: Record<string, number>;
  total_open: number;
  invoice_count: number;
  oldest_due_date: string;
};

export type CollectionRow = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_email?: string;
  total: number;
  status?: string;
  due_date?: string;
  days_overdue: number;
  collections_note?: string;
  collections_status?: string;
};

export function useARAging() {
  return useQuery({
    queryKey: ['ar-aging'],
    queryFn: () => fetchWithAuth<{ aging: AgingRow[] }>('/api/ar/aging'),
    select: (data) => (Array.isArray(data?.aging) ? data.aging : []),
  });
}

export function useARCollections() {
  return useQuery({
    queryKey: ['ar-collections'],
    queryFn: () => fetchWithAuth<CollectionRow[]>('/api/ar/collections'),
    select: (data) => (Array.isArray(data) ? data : []),
  });
}

export function useSendReminder() {
  return useMutation({
    mutationFn: (id: string) =>
      sendWithAuth<{ sent: number; total_owed: number }>(`/api/ar/remind/${encodeURIComponent(id)}`, 'POST'),
  });
}

export function useSaveCollectionNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, note, status }: { invoiceId: string; note: string; status: string }) =>
      sendWithAuth(`/api/ar/collections/${invoiceId}/note`, 'PATCH', { note, collections_status: status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ar-collections'] }),
  });
}
