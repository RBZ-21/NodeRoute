import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListWithAuth, sendWithAuth } from '../lib/api';

export type RouteRecord = {
  id: string;
  name?: string;
  status?: string;
  driver?: string;
  driver_id?: string | null;
  location_id?: string | null;
  stop_ids?: string[];
  active_stop_ids?: string[];
  notes?: string;
  dispatched_at?: string | null;
  created_at?: string;
};

export type StopRecord = {
  id: string;
  name?: string;
  address?: string;
  notes?: string;
  customer_id?: string | number | null;
  location_id?: string | null;
  lat?: number;
  lng?: number;
};

export type PendingOrder = {
  id: string;
  order_number?: string;
  customer_name?: string;
  customer_address?: string;
  customer_email?: string;
  status?: string;
};

export type Driver = {
  id: string;
  name?: string;
  email?: string;
};

export type Customer = {
  id?: string | number;
  customerId?: string;
  customer_id?: string;
  name?: string;
  customerName?: string;
  customer_name?: string;
  company_name?: string;
  address?: string;
  billing_address?: string;
};

export type OptimizeResult = {
  optimized_stop_ids: string[];
  key_changes: string[];
  estimated_efficiency_gain: string;
  reasoning: string;
};

export type AssignmentsResult = {
  assignments: { route_id: string; route_name: string; recommended_driver_name: string; reasoning: string; confidence: string }[];
  unassignable_routes: string[];
  summary: string;
};

// ── Queries ────────────────────────────────────────────────────────────────────

// Live data: the Routes workspace polls every 30s (no manual Refresh needed).
// TanStack Query clears the interval automatically on unmount.
export function useRoutes() {
  return useQuery<RouteRecord[]>({
    queryKey: ['routes'],
    queryFn: () => fetchListWithAuth<RouteRecord>('/api/routes'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useAllStops() {
  return useQuery<StopRecord[]>({
    queryKey: ['stops'],
    queryFn: () => fetchListWithAuth<StopRecord>('/api/stops'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function usePendingOrders() {
  return useQuery<PendingOrder[]>({
    queryKey: ['orders-pending'],
    queryFn: () =>
      fetchListWithAuth<PendingOrder>('/api/orders?status=pending')
        .then((d) => d.filter((o) => String(o.status || '').toLowerCase() === 'pending')),
    staleTime: 30_000,
  });
}

export function useDrivers() {
  return useQuery<Driver[]>({
    queryKey: ['drivers'],
    // .catch(() => []) is deliberate: drivers are an auxiliary lookup that can
    // 403 for lower roles; the Routes page should still render without it.
    queryFn: () => fetchListWithAuth<Driver>('/api/users').catch(() => []),
    staleTime: 60_000,
  });
}

export function useCustomers() {
  return useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: () => fetchListWithAuth<Customer>('/api/customers').catch(() => []),
    staleTime: 60_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export function useCreateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; driver: string; driverId?: string; notes: string }) =>
      sendWithAuth('/api/routes', 'POST', { ...payload, stopIds: [] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routes'] }),
  });
}

export function useUpdateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      sendWithAuth(`/api/routes/${id}`, 'PATCH', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routes'] }),
  });
}

export function useDeleteRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendWithAuth(`/api/routes/${id}`, 'DELETE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routes'] }),
  });
}

export function useCreateStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; address: string; notes?: string; customer_id?: string }) =>
      sendWithAuth<StopRecord>('/api/stops', 'POST', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stops'] }),
  });
}

export function useOptimizeRoute() {
  return useMutation({
    mutationFn: (routeId: string) =>
      sendWithAuth<OptimizeResult>('/api/ai/optimize-route', 'POST', { route_id: routeId }),
  });
}

export function useDriverAssignments() {
  return useMutation({
    mutationFn: () => sendWithAuth<AssignmentsResult>('/api/ai/driver-assignments', 'POST', {}),
  });
}
