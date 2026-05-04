import type {
  BootstrapPayload,
  DeliveryRecord,
  DriverInvoice,
  DriverRoute,
  DriverSummary,
  DriverUser,
} from '@/types';
import { loadToken } from '@/lib/storage';
import { getApiBaseUrl } from '@/lib/utils';

type RequestOptions = RequestInit & {
  skipAuth?: boolean;
  responseType?: 'json' | 'blob';
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function buildUrl(path: string) {
  const base = getApiBaseUrl();
  return base ? `${base}${path}` : path;
}

function readCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const { skipAuth = false, responseType = 'json', headers, ...rest } = options;
  const token = loadToken();
  const nextHeaders = new Headers(headers);

  if (!nextHeaders.has('Content-Type') && rest.body && !(rest.body instanceof FormData)) {
    nextHeaders.set('Content-Type', 'application/json');
  }

  if (!skipAuth && token) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }

  const method = rest.method || 'GET';
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
    const csrfToken = readCsrfToken();
    if (csrfToken) nextHeaders.set('X-CSRF-Token', csrfToken);
  }

  const response = await fetch(buildUrl(path), {
    credentials: 'include',
    headers: nextHeaders,
    ...rest,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload.error || payload.message || message;
    } catch {
      // Fall through with the HTTP status text.
    }

    throw new ApiError(message, response.status);
  }

  if (responseType === 'blob') return response.blob() as Promise<T>;
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export async function login(email: string, password: string) {
  return request<{ token: string; user: DriverUser }>('/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchBootstrapData() {
  const [routes, invoices, deliveries, summary] = await Promise.all([
    request<DriverRoute[]>('/api/driver/routes'),
    request<DriverInvoice[]>('/api/driver/invoices'),
    request<DeliveryRecord[]>('/api/deliveries/deliveries'),
    request<DriverSummary>('/api/deliveries/driver/summary'),
  ]);

  return {
    routes,
    invoices,
    deliveries,
    summary,
    cachedAt: new Date().toISOString(),
  } satisfies BootstrapPayload;
}

export async function pingDriverLocation(payload: {
  lat: number;
  lng: number;
  heading?: number | null;
  speed_mph?: number | null;
}) {
  return request('/api/driver/location', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function markStopArrived(stopId: string) {
  return request(`/api/stops/${stopId}/arrive`, {
    method: 'POST',
  });
}

export async function markStopDeparted(stopId: string) {
  return request(`/api/stops/${stopId}/depart`, {
    method: 'POST',
  });
}

export async function patchStop(stopId: string, payload: Record<string, unknown>) {
  return request(`/api/stops/${stopId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function patchDeliveryStatus(deliveryId: string, status: 'pending' | 'in-transit' | 'delivered') {
  return request(`/api/deliveries/deliveries/${deliveryId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function uploadProofOfDelivery(invoiceId: string, image: string) {
  return request(`/api/invoices/${invoiceId}/proof-of-delivery`, {
    method: 'POST',
    body: JSON.stringify({ proof_image_data: image }),
  });
}

export async function fetchInvoicePdf(invoiceId: string) {
  return request<Blob>(`/api/invoices/${invoiceId}/pdf`, {
    responseType: 'blob',
  });
}

export async function submitTemperatureLog(payload: Record<string, unknown>) {
  return request('/api/temperature-logs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logout() {
  return request('/auth/logout', {
    method: 'POST',
  });
}
