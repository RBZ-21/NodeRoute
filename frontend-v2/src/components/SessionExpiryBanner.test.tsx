import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionExpiryBanner } from './SessionExpiryBanner';
import { markSessionRenewed, SESSION_EXPIRES_AT_KEY, SESSION_TTL_MS } from '../lib/api';

describe('SessionExpiryBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('warns before the access session expires', () => {
    localStorage.setItem(SESSION_EXPIRES_AT_KEY, String(Date.now() + 5 * 60_000));

    render(<SessionExpiryBanner />);

    expect(screen.getByText('Your session will expire in 5 minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renew' })).toBeEnabled();
  });

  it('renews the session and refreshes the local expiry marker', async () => {
    localStorage.setItem(SESSION_EXPIRES_AT_KEY, String(Date.now() + 4 * 60_000));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { role: 'admin' } }),
    } as Response);

    render(<SessionExpiryBanner />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Session renewed.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    expect(localStorage.getItem(SESSION_EXPIRES_AT_KEY)).toBe(String(Date.now() + SESSION_TTL_MS));
  });

  it('does not render before the warning window', () => {
    markSessionRenewed();

    render(<SessionExpiryBanner />);

    expect(screen.queryByText(/Your session will expire/)).not.toBeInTheDocument();
  });
});
