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
      Map: function MockMap() { return {}; },
      Marker: function MockMarker() { return { addListener: vi.fn(), setMap: vi.fn() }; },
      InfoWindow: function MockInfoWindow() { return { open: vi.fn() }; },
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
    fetchWithAuthMock.mockResolvedValue({ key: 'test-map-key' });
    stubGoogleMaps();
  });

  it('explains that the live map is waiting on a dispatched route when no drivers are active', async () => {
    useMapDriversMock.mockReturnValue({ data: [], dataUpdatedAt: 0 });
    useMapStopsMock.mockReturnValue({ data: [] });

    renderWithQueryClient(<MapPage />);

    expect(await screen.findByText('Live map waiting on route movement')).toBeInTheDocument();
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
