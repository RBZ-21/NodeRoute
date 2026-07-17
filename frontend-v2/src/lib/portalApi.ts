/** Portal auth uses an HttpOnly cookie set by POST /api/portal/verify. */

export const PORTAL_SESSION_MARKER = 'portal-cookie-session';

export function getPortalToken(): string {
  try {
    sessionStorage.removeItem('portal_token');
  } catch {
    // Ignore legacy cleanup failures.
  }
  return '';
}

export function setPortalToken(_token: string) {
  try {
    sessionStorage.removeItem('portal_token');
  } catch {
    // Token is stored in an HttpOnly cookie by the server.
  }
}

export async function clearPortalSession() {
  try {
    sessionStorage.removeItem('portal_token');
  } catch {
    // Ignore storage failures.
  }
  try {
    await fetch('/api/portal/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // Best-effort server logout.
  }
}

async function parsePortalResponse<T>(response: Response, url: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (response.status === 401) {
    await clearPortalSession();
    throw new Error(String(data?.error || 'Your portal session expired. Please sign in again.'));
  }

  if (!response.ok) {
    throw new Error(String(data?.error || `Request failed: ${url}`));
  }

  if (data === null) {
    // An OK response that isn't JSON (e.g. a proxy or SPA fallback serving
    // HTML) is a failure — surface it instead of handing callers null.
    throw new Error(`Invalid response from ${url}`);
  }

  return data as T;
}

/**
 * Fetch a portal endpoint whose contract is a JSON array. Validates the shape
 * once at the boundary so callers don't each need an Array.isArray guard that
 * silently renders a broken response as "no data".
 */
export async function fetchPortalList<T>(url: string): Promise<T[]> {
  const data = await fetchWithPortalAuth<unknown>(url);
  if (!Array.isArray(data)) throw new Error(`Expected a list response from ${url}`);
  return data as T[];
}

export async function fetchWithPortalAuth<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  return parsePortalResponse<T>(response, url);
}

export async function sendWithPortalAuth<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parsePortalResponse<T>(response, url);
}

export async function fetchPortalBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: 'include' });

  if (response.status === 401) {
    await clearPortalSession();
    throw new Error('Your portal session expired. Please sign in again.');
  }
  if (!response.ok) {
    let message = `Request failed: ${url}`;
    try {
      const data = await response.json();
      message = String(data?.error || message);
    } catch {
      // Non-JSON response, keep fallback message.
    }
    throw new Error(message);
  }

  return response.blob();
}
