// FE-001 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: the watchPosition error callback nulled watchIdRef WITHOUT
// calling clearWatch(), orphaning the GPS watch permanently — it kept firing
// and stop() could no longer release it. There was also no unmount cleanup.

import { render } from '@testing-library/react';
import { act } from 'react';
import { useLocationSharing } from './useLocationSharing';

vi.mock('../lib/api', () => ({ sendWithAuth: vi.fn().mockResolvedValue({}) }));

type ErrorCb = (err: { message: string }) => void;

function mockGeolocation() {
  let errorCb: ErrorCb | null = null;
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((_success: unknown, error: ErrorCb) => {
    errorCb = error;
    return 42;
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition, clearWatch },
  });
  return { clearWatch, watchPosition, fireError: (msg: string) => errorCb?.({ message: msg }) };
}

function SharingProbe({ onReady }: { onReady: (api: ReturnType<typeof useLocationSharing>) => void }) {
  const api = useLocationSharing();
  onReady(api);
  return <div data-testid="status">{api.locationStatus.text}</div>;
}

describe('useLocationSharing (FE-001)', () => {
  it('clears the browser watch when the error callback fires', () => {
    const geo = mockGeolocation();
    let api!: ReturnType<typeof useLocationSharing>;
    render(<SharingProbe onReady={(a) => { api = a; }} />);

    act(() => api.startLocationSharing());
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);

    act(() => geo.fireError('Location access was blocked.'));

    // The original bug: ref nulled, clearWatch never called -> orphaned watch.
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
    expect(api.watchIdRef.current).toBeNull();
  });

  it('allows a clean restart after an error (no orphaned duplicate watches)', () => {
    const geo = mockGeolocation();
    let api!: ReturnType<typeof useLocationSharing>;
    render(<SharingProbe onReady={(a) => { api = a; }} />);

    act(() => api.startLocationSharing());
    act(() => geo.fireError('blocked'));
    act(() => api.startLocationSharing());

    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    // Exactly one clearWatch so far (from the error path) — the first watch
    // is not still running alongside the second.
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('clears an active watch on unmount', () => {
    const geo = mockGeolocation();
    let api!: ReturnType<typeof useLocationSharing>;
    const { unmount } = render(<SharingProbe onReady={(a) => { api = a; }} />);

    act(() => api.startLocationSharing());
    unmount();

    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });

  it('stop() releases the watch and resets state', () => {
    const geo = mockGeolocation();
    let api!: ReturnType<typeof useLocationSharing>;
    render(<SharingProbe onReady={(a) => { api = a; }} />);

    act(() => api.startLocationSharing());
    act(() => api.stopLocationSharing());

    expect(geo.clearWatch).toHaveBeenCalledWith(42);
    expect(api.watchIdRef.current).toBeNull();
  });
});
