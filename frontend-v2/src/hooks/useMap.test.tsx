import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDriveTimes } from './useMap';

const { fetchWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  fetchListWithAuth: (url: string) =>
    fetchWithAuthMock(url).then((d: unknown) => {
      if (!Array.isArray(d)) throw new Error(`Expected a list response from ${url}`);
      return d;
    }),
}));

function renderWithClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
  return {
    ...result,
    unmount: () => {
      result.unmount();
      queryClient.clear();
    },
  };
}

function DriveTimesProbe() {
  const driveTimes = useDriveTimes([
    { key: 'route-1', from: 'warehouse-1', to: 'customer-1' },
    { key: 'route-2', from: 'warehouse-1', to: 'customer-1' },
    { key: 'route-3', from: 'warehouse-2', to: 'customer-2' },
    { key: 'route-4', from: null, to: 'customer-3' },
  ]);
  return (
    <div>
      <span data-testid="status">{driveTimes.isSuccess ? 'ready' : 'loading'}</span>
      <span data-testid="route-1">{driveTimes.data?.['route-1']?.duration_seconds ?? 'none'}</span>
      <span data-testid="route-2">{driveTimes.data?.['route-2']?.duration_seconds ?? 'none'}</span>
      <span data-testid="route-3">{driveTimes.data?.['route-3']?.duration_seconds ?? 'none'}</span>
      <span data-testid="route-4">{driveTimes.data?.['route-4']?.duration_seconds ?? 'none'}</span>
    </div>
  );
}

describe('useDriveTimes', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.includes('from=warehouse-1') && url.includes('to=customer-1')) {
        return { duration_seconds: 600, distance_meters: 3200 };
      }
      if (url.includes('from=warehouse-2') && url.includes('to=customer-2')) {
        return { duration_seconds: 900, distance_meters: 4800 };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
  });

  it('deduplicates identical route drive-time pairs inside one query result', async () => {
    renderWithClient(<DriveTimesProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('route-1').textContent).toBe('600');
    expect(screen.getByTestId('route-2').textContent).toBe('600');
    expect(screen.getByTestId('route-3').textContent).toBe('900');
    expect(screen.getByTestId('route-4').textContent).toBe('none');
  });
});
