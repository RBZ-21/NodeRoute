import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadWithAuth } from './api';

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
