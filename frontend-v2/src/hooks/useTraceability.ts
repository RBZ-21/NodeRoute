import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export type LotTrace = {
  lot: {
    lot_number: string;
    product_id?: string;
    product?: string;
    vendor?: string;
    received_date?: string;
    received_by?: string;
    quantity_received?: number;
    unit_of_measure?: string;
    expiration_date?: string;
    notes?: string;
  };
  orders: {
    order_id: string;
    order_number?: string;
    customer?: string;
    customer_email?: string;
    status?: string;
    quantity?: number;
    delivery_date?: string;
  }[];
  stops: {
    stop_id: string;
    stop_name?: string;
    address?: string;
    quantity?: number;
    delivered_at?: string;
  }[];
};

export type ReportRow = {
  lot_number: string;
  product_id?: string;
  vendor?: string;
  received_date?: string;
  received_by?: string;
  qty_received?: number;
  unit_of_measure?: string;
  qty_shipped?: number;
  qty_remaining?: number;
  expiration_date?: string;
  notes?: string;
};

export type ReportResponse = {
  page: number;
  page_size: number;
  total: number;
  rows: ReportRow[];
};

export type ReportParams = {
  lot: string;
  product: string;
  dateFrom: string;
  dateTo: string;
  page: number;
};

// Enabled only when the user commits a lot number via the Trace button.
export function useLotTraceQuery(lotNumber: string | null) {
  return useQuery({
    queryKey: ['lot-trace', lotNumber] as const,
    queryFn: () =>
      fetchWithAuth<LotTrace>(`/api/lots/${encodeURIComponent(lotNumber!)}/trace`),
    enabled: !!lotNumber,
    staleTime: 30_000,
  });
}

// Committed params drive the key — changing any param (including page) triggers
// a new query without manual effect wiring.
export function useTraceabilityReportQuery(params: ReportParams) {
  return useQuery({
    queryKey: [
      'traceability-report',
      params.lot,
      params.product,
      params.dateFrom,
      params.dateTo,
      params.page,
    ] as const,
    queryFn: () => {
      const p = new URLSearchParams({ page: String(params.page), limit: '50' });
      if (params.lot)      p.set('lot',        params.lot);
      if (params.product)  p.set('product_id', params.product);
      if (params.dateFrom) p.set('date_from',  params.dateFrom);
      if (params.dateTo)   p.set('date_to',    params.dateTo);
      return fetchWithAuth<ReportResponse>(`/api/lots/traceability/report?${p}`);
    },
    staleTime: 30_000,
  });
}
