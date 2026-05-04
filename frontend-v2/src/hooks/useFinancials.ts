import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export type FinancialInvoice = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_email?: string;
  total?: number | string;
  status?: string;
  created_at?: string;
  due_date?: string;
};

export type FinancePurchaseOrder = {
  id: string;
  total_cost?: number | string;
};

export function useFinancialInvoicesQuery() {
  return useQuery({
    queryKey: ['financial-invoices'] as const,
    queryFn: () =>
      fetchWithAuth<FinancialInvoice[]>('/api/invoices').then((d) =>
        Array.isArray(d) ? d : [],
      ),
    staleTime: 30_000,
  });
}

export function useFinancePOsQuery() {
  return useQuery({
    queryKey: ['finance-purchase-orders'] as const,
    queryFn: () =>
      fetchWithAuth<FinancePurchaseOrder[]>('/api/purchase-orders').then((d) =>
        Array.isArray(d) ? d : [],
      ),
    staleTime: 30_000,
  });
}
