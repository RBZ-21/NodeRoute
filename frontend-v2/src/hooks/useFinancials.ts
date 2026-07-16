import { useQuery } from '@tanstack/react-query';
import { fetchListWithAuth } from '../lib/api';

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
      fetchListWithAuth<FinancialInvoice>('/api/invoices'),
    staleTime: 30_000,
  });
}

export function useFinancePOsQuery() {
  return useQuery({
    queryKey: ['finance-purchase-orders'] as const,
    queryFn: () =>
      fetchListWithAuth<FinancePurchaseOrder>('/api/purchase-orders'),
    staleTime: 30_000,
  });
}
