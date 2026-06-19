import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapPage } from './MapPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, useMapDriversMock, useMapStopsMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  useMapDriversMock: vi.fn(),
  useMapStopsMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

vi.mock('../hooks/useMap', () => ({
  useMapDrivers: useMapDriversMock,
  useMapStops: useMapStopsMock,
}));

function hasExactTextContent(text: string) {
  return (_: string, element: Element | null) => element?.textContent === text;
}

function stubGoogleMaps() {
  const googleMock = {
    maps: {
      Map: function MockMap() { return { setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() }; },
      Marker: function MockMarker() { return { addListener: vi.fn(), setMap: vi.fn() }; },
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
    fetchWithAuthMock.mockReset();
    useMapDriversMock.mockReset();
    useMapStopsMock.mockReset();
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
});
