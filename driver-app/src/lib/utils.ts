import type { DeliveryRecord, DriverInvoice, DriverRoute, DriverStop } from '@/types';

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function normalize(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function formatDateTime(value?: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatSchedule(stop: DriverStop) {
  const dateBits = [stop.scheduled_date, stop.scheduled_time].filter(Boolean);
  if (!dateBits.length) return 'Window pending';
  return dateBits.join(' ');
}

export function formatStatusLabel(status?: string | null) {
  const normalized = normalize(status);
  if (!normalized || normalized === 'pending') return 'Pending';
  if (normalized === 'arrived') return 'Arrived';
  if (normalized === 'completed' || normalized === 'delivered' || normalized === 'signed' || normalized === 'sent') {
    return 'Delivered';
  }
  if (normalized === 'failed') return 'Failed';
  return status || 'Pending';
}

export function statusTone(status?: string | null) {
  const normalized = normalize(status);
  if (normalized === 'arrived') return 'bg-yellow-100 text-yellow-800 ring-yellow-200';
  if (normalized === 'completed' || normalized === 'delivered' || normalized === 'signed' || normalized === 'sent') {
    return 'bg-emerald-100 text-emerald-800 ring-emerald-200';
  }
  if (normalized === 'failed') return 'bg-rose-100 text-rose-800 ring-rose-200';
  return 'bg-slate-200 text-slate-700 ring-slate-300';
}

export function getCurrentRoute(routes: DriverRoute[], selectedRouteId: string | null) {
  if (!routes.length) return null;
  return routes.find((route) => route.id === selectedRouteId) || routes[0];
}

export function getRouteInvoices(route: DriverRoute | null, invoices: DriverInvoice[]) {
  if (!route) return [];
  const invoiceIds = new Set(route.stops.map((stop) => stop.invoice_id).filter(Boolean));
  if (invoiceIds.size) {
    return invoices.filter((invoice) => invoiceIds.has(invoice.id));
  }

  return invoices.filter((invoice) =>
    route.stops.some((stop) =>
      normalize(stop.name) === normalize(invoice.customer_name) ||
      normalize(stop.address) === normalize(invoice.customer_address)
    )
  );
}

export function findLinkedDelivery(stop: DriverStop, deliveries: DeliveryRecord[]) {
  return deliveries.find((delivery) =>
    normalize(delivery.routeId) === normalize(stop.route_id) &&
    (
      normalize(delivery.address) === normalize(stop.address) ||
      normalize(delivery.restaurantName) === normalize(stop.name)
    )
  ) || null;
}

export function extractStopItems(stop: DriverStop, invoices: DriverInvoice[], deliveries: DeliveryRecord[]) {
  const invoice = stop.invoice_id ? invoices.find((candidate) => candidate.id === stop.invoice_id) : null;
  if (invoice?.items?.length) {
    return invoice.items.map((item) => {
      const description = String(item.description || item.name || item.item || 'Line item');
      const quantity = item.quantity ? ` x${item.quantity}` : '';
      return `${description}${quantity}`;
    });
  }

  const delivery = findLinkedDelivery(stop, deliveries);
  if (delivery?.items?.length) return delivery.items;
  return [];
}

export function isDeliveredStatus(status?: string | null) {
  const normalized = normalize(status);
  return normalized === 'completed' || normalized === 'delivered' || normalized === 'signed' || normalized === 'sent';
}

export function isArrivedStatus(status?: string | null) {
  return normalize(status) === 'arrived';
}

export function getApiBaseUrl() {
  return String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
}
