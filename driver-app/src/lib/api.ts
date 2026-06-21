import type {
  BootstrapPayload,
  CompanySettings,
  DeliveryRecord,
  DriverInvoice,
  DriverRoute,
  DriverSummary,
  DriverUser,
} from '@/types';
import { getApiBaseUrl } from '@/lib/utils';

type RequestOptions = RequestInit & {
  skipAuth?: boolean;
  responseType?: 'json' | 'blob';
  clientActionId?: string;
};

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
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
  return requestWithRefresh<T>(path, options, true);
}

async function requestWithRefresh<T>(path: string, options: RequestOptions = {}, allowRefresh: boolean): Promise<T> {
  const { skipAuth = false, responseType = 'json', clientActionId, headers, ...rest } = options;
  const nextHeaders = new Headers(headers);

  if (!nextHeaders.has('Content-Type') && rest.body && !(rest.body instanceof FormData)) {
    nextHeaders.set('Content-Type', 'application/json');
  }

  const method = rest.method || 'GET';
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
    const csrfToken = readCsrfToken();
    if (csrfToken) nextHeaders.set('X-CSRF-Token', csrfToken);
  }
  if (clientActionId) {
    nextHeaders.set('X-Client-Action-Id', clientActionId);
  }

  const response = await fetch(buildUrl(path), {
    credentials: 'include',
    headers: nextHeaders,
    ...rest,
  });

  if (response.status === 401 && allowRefresh && !skipAuth) {
    const refreshed = await refreshDriverToken();
    if (refreshed) return requestWithRefresh<T>(path, options, false);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let details: unknown;
    try {
      const payload = await response.json();
      details = payload;
      message = payload.error || payload.message || message;
    } catch {
      // Fall through with the HTTP status text.
    }

    throw new ApiError(message, response.status, details);
  }

  if (responseType === 'blob') return response.blob() as Promise<T>;
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

async function refreshDriverToken() {
  const response = await fetch(buildUrl('/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) return false;

  await response.json().catch(() => ({}));
  return true;
}

export async function login(email: string, password: string) {
  return request<{ user: DriverUser }>('/auth/driver/login', {
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

export async function fetchCompanySettings() {
  return request<CompanySettings>('/api/settings/company');
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

export async function markStopArrived(stopId: string, clientActionId?: string) {
  return request(`/api/stops/${stopId}/arrive`, {
    method: 'POST',
    clientActionId,
  });
}

export async function markStopDeparted(stopId: string, payload?: Record<string, unknown>, clientActionId?: string) {
  return request(`/api/stops/${stopId}/depart`, {
    method: 'POST',
    body: payload ? JSON.stringify(payload) : undefined,
    clientActionId,
  });
}

export async function deferStop(stopId: string, clientActionId?: string) {
  return request(`/api/stops/${stopId}/defer`, {
    method: 'POST',
    clientActionId,
  });
}

export async function patchStop(stopId: string, payload: Record<string, unknown>, clientActionId?: string) {
  return request(`/api/stops/${stopId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    clientActionId,
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

export async function saveStopSignature(stopId: string, signatureData: string, signerName?: string) {
  return request(`/api/stops/${stopId}/signature`, {
    method: 'POST',
    body: JSON.stringify({
      signature_data: signatureData,
      signer_name: signerName?.trim() || undefined,
    }),
  });
}

export async function fetchInvoicePdf(invoiceId: string) {
  return request<Blob>(`/api/invoices/${invoiceId}/pdf`, {
    responseType: 'blob',
  });
}

export async function submitTemperatureLog(payload: Record<string, unknown>, clientActionId?: string) {
  return request('/api/temperature-logs', {
    method: 'POST',
    body: JSON.stringify(payload),
    clientActionId,
  });
}

export async function logout() {
  return request('/auth/logout', {
    method: 'POST',
  });
}
