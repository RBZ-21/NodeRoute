import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  fetchListWithAuth,
  fetchWithAuth,
  loginRedirectUrl,
  markSessionRenewed,
  renewSession,
  SESSION_EXPIRES_AT_KEY,
  SESSION_TTL_MS,
  uploadWithAuth,
} from './api';

describe('uploadWithAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'csrf-token=; Max-Age=0; path=/';
  });

  it('sends multipart uploads with credentials and the CSRF header', async () => {
    document.cookie = 'csrf-token=test-csrf-token; path=/';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    const file = new File(['invoice'], 'invoice.png', { type: 'image/png' });
    await uploadWithAuth('/api/ai/scan-po', 'image', file);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/scan-po',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': 'test-csrf-token' },
        body: expect.any(FormData),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('headers.Content-Type');
  });
});

describe('response parsing contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces an OK response with a non-JSON body as an error instead of {}', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    } as unknown as Response);

    await expect(fetchWithAuth('/api/orders')).rejects.toThrow('Invalid JSON response from /api/orders');
  });

  it('still resolves 204 No Content responses as an empty object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => { throw new SyntaxError('no body'); },
    } as unknown as Response);

    await expect(fetchWithAuth('/api/driver/location')).resolves.toEqual({});
  });

  it('still mines error messages from non-OK JSON bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    } as unknown as Response);

    await expect(fetchWithAuth('/api/orders')).rejects.toThrow('boom');
  });

  it('fetchListWithAuth returns array payloads as-is', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: '1' }],
    } as unknown as Response);

    await expect(fetchListWithAuth('/api/orders')).resolves.toEqual([{ id: '1' }]);
  });

  it('fetchListWithAuth rejects non-array payloads instead of coercing to []', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 'shape changed' }),
    } as unknown as Response);

    await expect(fetchListWithAuth('/api/orders')).rejects.toThrow('Expected a list response from /api/orders');
  });
});

describe('session renewal helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('stores the expected access-session expiry marker', () => {
    const now = Date.UTC(2026, 5, 4, 12, 0, 0);

    const expiresAt = markSessionRenewed(now);

    expect(expiresAt).toBe(now + SESSION_TTL_MS);
    expect(localStorage.getItem(SESSION_EXPIRES_AT_KEY)).toBe(String(expiresAt));
  });

  it('renews via the refresh endpoint and updates the user session marker', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { role: 'admin' } }),
    } as Response);

    await expect(renewSession()).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    expect(localStorage.getItem('nr_user')).toBe(JSON.stringify({ role: 'admin' }));
    expect(localStorage.getItem(SESSION_EXPIRES_AT_KEY)).toBe(String(1_000 + SESSION_TTL_MS));
  });

  it('clears the expiry marker with the local session', () => {
    localStorage.setItem('nr_user', '{"role":"admin"}');
    localStorage.setItem(SESSION_EXPIRES_AT_KEY, '123');

    clearSession();

    expect(localStorage.getItem('nr_user')).toBeNull();
    expect(localStorage.getItem(SESSION_EXPIRES_AT_KEY)).toBeNull();
  });
});

describe('auth redirect helpers', () => {
  it('keeps dashboard-v2 mounted routes inside the configured Vite base', () => {
    expect(loginRedirectUrl('/dashboard-v2/orders?tab=routes', '/dashboard-v2/'))
      .toBe('/dashboard-v2/login?next=%2Fdashboard-v2%2Forders%3Ftab%3Droutes');
  });

  it('keeps root-mounted routes on root login even when a dashboard base is configured', () => {
    expect(loginRedirectUrl('/orders', '/dashboard-v2/')).toBe('/login?next=%2Forders');
  });
});
