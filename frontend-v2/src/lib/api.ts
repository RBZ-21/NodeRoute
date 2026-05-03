const AUTH_ERROR_KEY = 'nr_auth_error';

function saveAuthError(message: string) {
  try { sessionStorage.setItem(AUTH_ERROR_KEY, message); } catch {}
}

export function readAndClearAuthError(): string {
  try {
    const message = sessionStorage.getItem(AUTH_ERROR_KEY) || '';
    if (message) sessionStorage.removeItem(AUTH_ERROR_KEY);
    return message;
  } catch { return ''; }
}

export function clearSession() {
  localStorage.removeItem('nr_token');
  localStorage.removeItem('nr_user');
}

export function redirectToLogin(message?: string) {
  if (message) saveAuthError(message);
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = currentPath && currentPath !== '/login' ? `?next=${encodeURIComponent(currentPath)}` : '';
  window.location.href = `/login${next}`;
}

async function parseResponse<T>(response: Response, url: string): Promise<T> {
  if (response.status === 401) {
    clearSession();
    redirectToLogin('Your session could not be verified. Please sign in again.');
    throw new Error('Unauthorized');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed: ${url}`);
  return data as T;
}

export async function fetchWithAuth<T>(url: string): Promise<T> {
  const token = localStorage.getItem('nr_token');
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return parseResponse<T>(response, url);
}

export async function sendWithAuth<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const token = localStorage.getItem('nr_token');
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse<T>(response, url);
}

export async function fetchCurrentUser<T>(): Promise<T> {
  return fetchWithAuth<T>('/auth/me');
}

/**
 * Role hierarchy (highest to lowest):
 *   superadmin > admin > manager > driver > unknown
 *
 * superadmin  — NodeRoute platform owner (admin@noderoutesystems.com)
 *               Sees all tenant companies and every page.
 * admin       — Business owner / manager of a single tenant company.
 *               Full access to their own company; no cross-tenant visibility.
 * manager     — Staff who place orders, print invoices, build routes.
 *               No access to Purchasing, Vendors, or Operations.
 * driver      — Only their own assigned routes and invoices.
 * unknown     — Not authenticated / unrecognised role.
 */
export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'unknown';

export function getUserRole(): Role {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return 'unknown';
    const parsed = JSON.parse(raw);
    const role = String(parsed?.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'admin' || role === 'manager' || role === 'driver') {
      return role as Role;
    }
  } catch { return 'unknown'; }
  return 'unknown';
}

/** Returns true if the user's role meets or exceeds the required minimum. */
export function hasRole(userRole: Role, required: Role): boolean {
  const order: Role[] = ['unknown', 'driver', 'manager', 'admin', 'superadmin'];
  return order.indexOf(userRole) >= order.indexOf(required);
}

export function requireAuthToken(): boolean {
  return !!localStorage.getItem('nr_token');
}
