export type DriverTab = 'route' | 'analytics' | 'notes' | 'invoices';

export type DriverStop = {
  id: string;
  position?: number;
  name?: string;
  address?: string;
  notes?: string;
  door_code?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_signed_at?: string | null;
  invoice_has_signature?: boolean;
  invoice_has_proof_of_delivery?: boolean;
  invoice_proof_of_delivery_uploaded_at?: string | null;
};

export type DriverRoute = {
  id: string;
  name?: string;
  driver?: string;
  stops?: DriverStop[];
};

export type DwellRecord = {
  id: string;
  stopId: string;
  routeId?: string;
  arrivedAt?: string | null;
  departedAt?: string | null;
  dwellMs?: number | null;
};

export type DeliverySummary = {
  id: number;
  orderId: string;
  restaurantName: string;
  status: string;
  distanceMiles?: number;
  stopDurationMinutes?: number | null;
  onTime?: boolean | null;
};

export type DriverInvoice = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_address?: string;
  total?: number | string;
  status?: string;
  created_at?: string;
  signed_at?: string | null;
};

export type CompanySettings = {
  forceDriverSignature?: boolean;
  forceDriverProofOfDelivery?: boolean;
};

export type LocationStatusTone = 'neutral' | 'success' | 'warning' | 'error';

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

export function asDriverNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatMoney(value: number | string | undefined) {
  return asDriverNumber(value, 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

export function routeProgress(stops: DriverStop[], dwell: DwellRecord[], routeId: string) {
  const completed = stops.filter((stop) => {
    const record = dwell.find((item) => item.stopId === stop.id && String(item.routeId || '') === routeId && !!item.departedAt);
    return !!record;
  }).length;
  return {
    completed,
    total: stops.length,
    percent: stops.length ? Math.round((completed / stops.length) * 100) : 0,
  };
}

export function dwellForStop(stopId: string, routeId: string, dwell: DwellRecord[]) {
  return dwell.find((item) => item.stopId === stopId && String(item.routeId || '') === routeId) || null;
}

export function stopStatus(stop: DriverStop, routeId: string, dwell: DwellRecord[]) {
  const record = dwellForStop(stop.id, routeId, dwell);
  if (record?.departedAt) return 'completed';
  if (record?.arrivedAt) return 'arrived';
  if (stop.invoice_has_signature) return 'ready';
  return 'pending';
}

export function stopBadgeVariant(status: string): 'warning' | 'secondary' | 'success' | 'neutral' {
  if (status === 'arrived') return 'secondary';
  if (status === 'completed' || status === 'ready') return 'success';
  return 'warning';
}

export function upsertDwell(list: DwellRecord[], record: DwellRecord): DwellRecord[] {
  const index = list.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = record;
    return next;
  }
  return [...list, record];
}
