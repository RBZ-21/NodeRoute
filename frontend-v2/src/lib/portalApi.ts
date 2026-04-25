const PORTAL_TOKEN_KEY = 'portal_token';

export function getPortalToken(): string {
  try {
    return sessionStorage.getItem(PORTAL_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setPortalToken(token: string) {
  try {
    sessionStorage.setItem(PORTAL_TOKEN_KEY, token);
  } catch {
    // Ignore storage failures and rely on in-memory state.
  }
}

export function clearPortalSession() {
  try {
    sessionStorage.removeItem(PORTAL_TOKEN_KEY);
  } catch {
    // Ignore storage failures.
  }
}

async function parsePortalResponse<T>(response: Response, url: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (response.status === 401) {
    clearPortalSession();
    throw new Error(String(data?.error || 'Your portal session expired. Please sign in again.'));
  }

  if (!response.ok) {
    throw new Error(String(data?.error || `Request failed: ${url}`));
  }

  return data as T;
}

export async function fetchWithPortalAuth<T>(url: string): Promise<T> {
  const token = getPortalToken();
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return parsePortalResponse<T>(response, url);
}

export async function sendWithPortalAuth<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<T> {
  const token = getPortalToken();
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parsePortalResponse<T>(response, url);
}

export async function fetchPortalBlob(url: string): Promise<Blob> {
  const token = getPortalToken();
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (response.status === 401) {
    clearPortalSession();
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
