import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackPage } from './TrackPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

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

    renderWithQueryClient(<TrackPage />);

    expect(screen.getByText('No tracking token')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces expired and invalid tracking links from API responses', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({}, 410));

    const { unmount } = renderWithQueryClient(<TrackPage />);

    expect(await screen.findByText('Tracking link expired')).toBeInTheDocument();
    unmount();

    fetchMock.mockReset();
    setTrackUrl('?token=missing-token');
    fetchMock.mockResolvedValueOnce(mockJsonResponse({}, 404));

    renderWithQueryClient(<TrackPage />);

    expect(await screen.findByText('Tracking link not found')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/track/missing-token');
  });

  it('renders tracking details for a successful response', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(baseTrackingData));

    renderWithQueryClient(<TrackPage />);

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

  it('holds ETA and live-map messaging until the route has actually departed', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        ...baseTrackingData,
        outingStarted: false,
        eta: null,
      }),
    );

    renderWithQueryClient(<TrackPage />);

    expect(await screen.findByText('Route Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Waiting to depart')).toBeInTheDocument();
    expect(screen.getByText('ETA will appear once this outing leaves the shop.')).toBeInTheDocument();
    expect(screen.getByText(/Customer ETA updates stay paused until dispatch starts/i)).toBeInTheDocument();
    expect(screen.getByText(/Live map tracking turns on after this route is dispatched/i)).toBeInTheDocument();
    expect(screen.queryByText(/Estimated delivery by/)).not.toBeInTheDocument();
  });

  it('toggles delivery notifications and persists the preference to localStorage', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(baseTrackingData));

    renderWithQueryClient(<TrackPage />);

    const button = await screen.findByRole('button', { name: 'Notify off' });
    expect(localStorage.getItem('nr-track-notify:track-token')).toBeNull();

    fireEvent.click(button);

    expect(localStorage.getItem('nr-track-notify:track-token')).toBe('true');
    expect(await screen.findByRole('button', { name: 'Notify me' })).toBeInTheDocument();
  });
});
