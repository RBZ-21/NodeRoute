import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackPage } from './TrackPage';

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const fetchMock = vi.fn<(...args: unknown[]) => Promise<MockResponse>>();

const baseTrackingData = {
  orderId: 'ord-100',
  orderNumber: '100',
  status: 'processed',
  deliveryAddress: '123 Harbor Way',
  customerName: 'Harbor Cafe',
  customerEmail: 'ops@harbor.example',
  customerPhone: '555-0100',
  stopsBeforeYou: 1,
  totalRouteStops: 4,
  driver: {
    name: 'Alex Driver',
    lat: 34.0522,
    lng: -118.2437,
    heading: 180,
    speed_mph: 32,
    updatedAt: null,
  },
  destination: { lat: null, lng: null },
  eta: {
    totalMinutes: 35,
    driveMinutes: 20,
    dwellMinutes: 15,
    etaTime: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
  },
};

function mockJsonResponse(body: unknown, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function setTrackUrl(search = '') {
  window.history.pushState({}, '', `/track${search}`);
}

describe('TrackPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    setTrackUrl('?t=track-token');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows an incomplete-link error when the tracking token is missing', () => {
    setTrackUrl('');

    render(<TrackPage />);

    expect(screen.getByText('No tracking token')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces expired and invalid tracking links from API responses', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({}, 410));

    const { unmount } = render(<TrackPage />);

    expect(await screen.findByText('Tracking link expired')).toBeInTheDocument();
    unmount();

    fetchMock.mockReset();
    setTrackUrl('?token=missing-token');
    fetchMock.mockResolvedValueOnce(mockJsonResponse({}, 404));

    render(<TrackPage />);

    expect(await screen.findByText('Tracking link not found')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/track/missing-token');
  });

  it('renders tracking details for a successful response', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(baseTrackingData));

    render(<TrackPage />);

    expect(await screen.findByText('NodeRoute Delivery Tracker')).toBeInTheDocument();
    expect(screen.getByText('Order #100')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Harbor Cafe' })).toBeInTheDocument();
    expect(screen.getAllByText('Out for Delivery')).toHaveLength(2);
    expect(screen.getByText('Stops before yours')).toBeInTheDocument();
    expect(screen.getByText('4 stops total')).toBeInTheDocument();
    expect(screen.getByText('Alex Driver')).toBeInTheDocument();
    expect(screen.getByText('Location unknown')).toBeInTheDocument();
    expect(screen.getByText('123 Harbor Way')).toBeInTheDocument();
    expect(screen.getByText(/Estimated delivery by/)).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/api/track/track-token');
    });
  });

  it('toggles delivery notifications and persists the preference to localStorage', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(baseTrackingData));

    render(<TrackPage />);

    const button = await screen.findByRole('button', { name: 'Notify off' });
    expect(localStorage.getItem('nr-track-notify:track-token')).toBeNull();

    fireEvent.click(button);

    expect(localStorage.getItem('nr-track-notify:track-token')).toBe('true');
    expect(await screen.findByRole('button', { name: 'Notify me' })).toBeInTheDocument();
  });
});
