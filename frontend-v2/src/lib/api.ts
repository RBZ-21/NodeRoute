export async function fetchWithAuth<T>(url: string): Promise<T> {
  const token = localStorage.getItem('nr_token');
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (response.status === 401) {
    localStorage.removeItem('nr_token');
    localStorage.removeItem('nr_user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${url}`);
  }
  return data as T;
}

export function getUserRole(): 'admin' | 'manager' | 'driver' | 'unknown' {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return 'unknown';
    const parsed = JSON.parse(raw);
    const role = String(parsed?.role || '').toLowerCase();
    if (role === 'admin' || role === 'manager' || role === 'driver') return role;
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

export function requireAuthToken(): boolean {
  return !!localStorage.getItem('nr_token');
}
