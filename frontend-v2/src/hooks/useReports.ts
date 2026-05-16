import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export type ReportPreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'range';

export type SalesReportItem = {
  key: string;
  label: string;
  item_number?: string | null;
  qty: number;
  revenue: number;
  invoice_count: number;
  delivery_revenue: number;
  pickup_revenue: number;
};

export type SalesReportSummary = {
  generated_at?: string;
  filters?: {
    preset?: string;
    start?: string | null;
    end?: string | null;
    item?: string | null;
  };
  overview: {
    total_sales: number;
    delivery_sales: number;
    pickup_sales: number;
    unknown_sales: number;
    invoice_count: number;
    order_count: number;
    average_invoice: number;
    item_count: number;
  };
  items: SalesReportItem[];
  available_items: Array<{ key: string; label: string; item_number?: string | null }>;
};

export function useSalesReport(
  preset: ReportPreset,
  startDate: string,
  endDate: string,
  itemFilter: string
) {
  return useQuery({
    queryKey: ['sales-report', preset, startDate, endDate, itemFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('preset', preset);
      if (preset === 'range') {
        if (startDate) params.set('start', startDate);
        if (endDate) params.set('end', endDate);
      }
      if (itemFilter !== 'all') params.set('item', itemFilter);
      return fetchWithAuth<SalesReportSummary>(`/api/reporting/sales-summary?${params.toString()}`);
    },
    staleTime: 60_000,
  });
}
