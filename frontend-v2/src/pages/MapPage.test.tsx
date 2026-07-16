import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapPage } from './MapPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, useMapDriversMock, useMapStopsMock, useRoutePolylineMock, polylineMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  useMapDriversMock: vi.fn(),
  useMapStopsMock: vi.fn(),
  useRoutePolylineMock: vi.fn(),
  polylineMock: vi.fn(function MockPolyline() { return { setMap: vi.fn() }; }),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  fetchListWithAuth: (url: string) =>
    fetchWithAuthMock(url).then((d: unknown) => {
      if (!Array.isArray(d)) throw new Error(`Expected a list response from ${url}`);
      return d;
    }),
}));

vi.mock('../hooks/useMap', () => ({
  useMapDrivers: useMapDriversMock,
  useMapStops: useMapStopsMock,
  useRoutePolyline: useRoutePolylineMock,
}));

function hasExactTextContent(text: string) {
  return (_: string, element: Element | null) => element?.textContent === text;
}

function stubGoogleMaps() {
  const googleMock = {
    maps: {
      Map: function MockMap() { return { setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() }; },
      Marker: function MockMarker() { return { addListener: vi.fn(), setMap: vi.fn() }; },
      Polyline: polylineMock,
      geometry: { encoding: { decodePath: vi.fn(() => [{ lat: 32.781, lng: -79.931 }, { lat: 32.785, lng: -79.928 }]) } },
      InfoWindow: function MockInfoWindow() { return { open: vi.fn() }; },
      LatLngBounds: function MockLatLngBounds() { return { extend: vi.fn(), getCenter: vi.fn(() => ({ lat: 0, lng: 0 })) }; },
      SymbolPath: { CIRCLE: 0 },
      Size: function MockSize() {},
      Point: function MockPoint() {},
    },
  };
  vi.stubGlobal('google', googleMock);
  (window as any).google = googleMock;
}

describe('MapPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_MAPS_PUBLIC_KEY', 'test-browser-key');
    fetchWithAuthMock.mockReset();
    useMapDriversMock.mockReset();
    useMapStopsMock.mockReset();
    useRoutePolylineMock.mockReset();
    polylineMock.mockClear();
    useRoutePolylineMock.mockReturnValue({ data: null, isError: false, error: null, isLoading: false });
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/stats') {
        return {
          totalDeliveries: 12,
          completedToday: 8,
          onTimeRate: 92,
          activeDrivers: 3,
          totalDrivers: 4,
          failed: 1,
          pendingCount: 2,
          inTransitCount: 2,
          yesterday: {
            totalDeliveries: 10,
            completedToday: 7,
            onTimeRate: 88,
            activeDrivers: 2,
            totalDrivers: 4,
            failed: 0,
            pendingCount: 1,
            inTransitCount: 1,
          },
        };
      }
      if (url === '/api/analytics') {
        return {
          avgStopTime: '14.2',
          onTimeRate: '92',
          avgSpeed: '31.4',
          driverRankings: [
            { name: 'Alex Driver', stopsPerHour: 2.4, avgStopMinutes: 14.2, avgSpeedMph: 31.4, onTimeRate: 96, milesToday: 42 },
          ],
          doorBreakdown: { 'Door code on file': 5, 'No code': 2 },
        };
      }
      if (url === '/api/deliveries') {
        return [
          { id: 1, orderId: 'ORD-1', restaurantName: 'Blue Fin', driverName: 'Alex Driver', status: 'pending', deliveryDoor: 'Back', distanceMiles: 8.5, routeId: 'route-1', createdAt: '2026-04-10T00:00:00Z' },
        ];
      }
      if (url === '/api/drivers') {
        return [
          { id: 'd1', name: 'Alex Driver', status: 'on-duty', totalStopsToday: 10, milesToday: 42, avgStopMinutes: 14, avgSpeedMph: 31, onTimeRate: 96 },
        ];
      }
      if (url === '/api/routes') {
        return [
          { id: 'route-1', name: 'North Route', driver: 'Alex Driver', stop_ids: ['s1', 's2'], active_stop_ids: ['s1', 's2'], created_at: '2026-04-10T00:00:00Z' },
        ];
      }
      return [];
    });
    stubGoogleMaps();
  });

  it('explains that the live map is waiting on a dispatched route when no drivers are active', async () => {
    useMapDriversMock.mockReturnValue({ data: [], dataUpdatedAt: 0 });
    useMapStopsMock.mockReturnValue({ data: [] });

    renderWithQueryClient(<MapPage />);

    expect(await screen.findByText('Live map waiting on route movement')).toBeInTheDocument();
    expect(await screen.findByText('Operational Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Driver Leaderboard')).toBeInTheDocument();
    expect(screen.getByText(/Dispatch a route once the truck leaves the shop to start live tracking/i)).toBeInTheDocument();
    expect(screen.getByText(hasExactTextContent('Drivers on duty: 0'))).toBeInTheDocument();
    expect(screen.getByText(hasExactTextContent('Drivers sending GPS: 0'))).toBeInTheDocument();
  });

  it('warns when drivers are on duty but no GPS coordinates are flowing yet', async () => {
    useMapDriversMock.mockReturnValue({
      data: [
        { id: 'driver-1', name: 'Ryan', status: 'on-duty', current_stop: 'Dockside Market', lat: null, lng: null },
      ],
      dataUpdatedAt: 0,
    });
    useMapStopsMock.mockReturnValue({ data: [] });

    renderWithQueryClient(<MapPage />);

    expect(await screen.findByText('Live map waiting on route movement')).toBeInTheDocument();
    expect(screen.getByText(/no GPS coordinates are flowing yet/i)).toBeInTheDocument();
    expect(screen.getByText('Waiting on GPS from driver app')).toBeInTheDocument();
    expect(screen.getByText(hasExactTextContent('Drivers sending GPS: 0'))).toBeInTheDocument();
  });

  it('renders route sequence labels and a Google polyline overlay from route map data', async () => {
    useMapDriversMock.mockReturnValue({
      data: [{ id: 'driver-1', name: 'Ryan', status: 'on-duty', current_stop: 'Blue Fin', lat: 32.78, lng: -79.93 }],
      dataUpdatedAt: Date.now(),
      refetch: vi.fn(),
      isFetching: false,
    });
    useMapStopsMock.mockReturnValue({
      data: [{ id: 'stop-1', address: '1 Dock St', status: 'pending', lat: 32.781, lng: -79.931 }],
      refetch: vi.fn(),
    });
    useRoutePolylineMock.mockReturnValue({
      data: {
        route_id: 'route-1',
        encoded_polyline: 'encoded-route',
        stops: [
          { stop_id: 'stop-1', sequence: 1, name: 'Blue Fin', address: '1 Dock St', lat: 32.781, lng: -79.931, duration_seconds: 720 },
          { stop_id: 'stop-2', sequence: 2, name: 'Red Crab', address: '2 Pier Ave', lat: 32.785, lng: -79.928, duration_seconds: 540 },
        ],
      },
      isError: false,
      error: null,
      isLoading: false,
    });

    renderWithQueryClient(<MapPage />);

    expect(await screen.findByText('Route Sequence')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blue Fin').length).toBeGreaterThan(0);
    expect(screen.getByText('12 min')).toBeInTheDocument();
    expect(screen.getByText('Red Crab')).toBeInTheDocument();
    expect(screen.getByText('9 min')).toBeInTheDocument();
    await waitFor(() => expect(polylineMock).toHaveBeenCalled());
  });

  it('shows a map workflow error when route polyline loading hits quota', async () => {
    useMapDriversMock.mockReturnValue({ data: [], dataUpdatedAt: 0 });
    useMapStopsMock.mockReturnValue({ data: [] });
    useRoutePolylineMock.mockReturnValue({
      data: null,
      isError: true,
      error: new Error('Google Maps quota exceeded'),
      isLoading: false,
    });

    renderWithQueryClient(<MapPage />);

    expect(await screen.findByText(/Google Maps quota exceeded/i)).toBeInTheDocument();
  });
});
