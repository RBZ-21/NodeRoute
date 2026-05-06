import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type InvoiceLotEntry = {
  item_number?: string;
  description?: string;
  lot_number: string;
  qty?: number | string;
  weight?: number | string;
};

export type Invoice = {
  id?: string | number;
  invoiceNumber?: string;
  invoice_number?: string;
  orderId?: string;
  order_id?: string;
  customerId?: string;
  customer_id?: string;
  customerName?: string;
  customer_name?: string;
  amount?: number | string;
  status?: string;
  dueDate?: string;
  due_date?: string;
  issuedDate?: string;
  issued_date?: string;
  paidDate?: string;
  paid_date?: string;
  notes?: string;
  lot_numbers?: InvoiceLotEntry[];
};

export function useInvoices() {
  return useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn: () => fetchWithAuth<Invoice[]>('/api/invoices').then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 30_000,
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string | number; patch: Record<string, unknown> }) =>
      sendWithAuth(`/api/invoices/${id}`, 'PATCH', patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => sendWithAuth(`/api/invoices/${id}`, 'DELETE'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}
