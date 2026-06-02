// JWT migration: Step 3 — tokens are now stored in HttpOnly cookies only.
// The browser sends the cookie automatically; we no longer read/write nr_token.
// nr_user remains in localStorage for role-based UI rendering only.
// See docs/security/jwt-migration.md for the full migration plan.

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
  // JWT migration Steps 1-3 complete for the browser app: tokens live only in
  // HttpOnly cookies, so there is no longer a legacy nr_token to wipe here.
  localStorage.removeItem('nr_user');
}

export function redirectToLogin(message?: string) {
  if (message) saveAuthError(message);
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = currentPath && currentPath !== '/login' ? `?next=${encodeURIComponent(currentPath)}` : '';
  window.location.href = `/login${next}`;
}

/** Read the CSRF token from the readable csrf-token cookie the server sets on login. */
function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    if (payload?.user) localStorage.setItem('nr_user', JSON.stringify(payload.user));
    return true;
  } catch {
    return false;
  }
}

async function parseResponse<T>(response: Response, url: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed: ${url}`);
  return data as T;
}

async function parseResponseWithRefresh<T>(response: Response, url: string, retry: () => Promise<Response>): Promise<T> {
  if (response.status === 401 && await refreshSession()) {
    response = await retry();
  }
  if (response.status === 401) {
    clearSession();
    redirectToLogin('Your session could not be verified. Please sign in again.');
    throw new Error('Unauthorized');
  }
  return parseResponse<T>(response, url);
}

export async function fetchWithAuth<T>(url: string): Promise<T> {
  const makeRequest = () => fetch(url, {
    credentials: 'include',
  });
  return parseResponseWithRefresh<T>(await makeRequest(), url, makeRequest);
}

export async function sendWithAuth<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const makeRequest = () => fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponseWithRefresh<T>(await makeRequest(), url, makeRequest);
}

/**
 * Upload a file (multipart/form-data) with auth cookies.
 * Do NOT set Content-Type manually — the browser must set it with the
 * correct boundary for multipart. Mutating upload routes still need the
 * readable CSRF token header because authenticateToken enforces it for POSTs.
 *
 * @param url    - The endpoint, e.g. '/api/purchase-orders/scan'
 * @param field  - The multer field name expected by the server, e.g. 'image'
 * @param file   - The File object from the input or drop event
 */
export async function uploadWithAuth<T>(url: string, field: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append(field, file);
  const makeRequest = () => fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-CSRF-Token': getCsrfToken(),
    },
    // No Content-Type header: browser sets multipart/form-data + boundary automatically.
    body: formData,
  });
  return parseResponseWithRefresh<T>(await makeRequest(), url, makeRequest);
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
  // With cookie auth, we check nr_user in localStorage as a lightweight
  // session indicator. The real auth gate is the HttpOnly cookie on the server.
  return !!localStorage.getItem('nr_user');
}
