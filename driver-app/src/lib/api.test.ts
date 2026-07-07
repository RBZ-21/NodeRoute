import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadProofOfDelivery } from './api';

/**
 * DR-008: uploadProofOfDelivery was the one mutating driver call that did not
 * forward a client action id, so a retried delivery re-uploaded the photo with
 * no way for the backend to dedupe it. These tests pin the fixed behavior.
 */
describe('uploadProofOfDelivery — idempotency key (DR-008)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('forwards clientActionId as the X-Client-Action-Id header', async () => {
    const fetchMock = stubFetch();

    await uploadProofOfDelivery('invoice-1', 'data:image/jpeg;base64,AAAA', 'abc123def456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Client-Action-Id')).toBe('abc123def456');
  });

  it('omits the header when no clientActionId is provided', async () => {
    const fetchMock = stubFetch();

    await uploadProofOfDelivery('invoice-1', 'data:image/jpeg;base64,AAAA');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Client-Action-Id')).toBeNull();
  });
});
