import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverPage } from './DriverPage';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

const baseRoutes = [
  {
    id: 'route-1',
    name: 'North Route',
    driver: 'Alex Driver',
    stops: [
      {
        id: 'stop-1',
        name: 'Blue Fin',
        address: '1 Dock Street',
        notes: 'Use the back entrance.',
        door_code: '1357',
        invoice_id: 'inv-1',
        invoice_number: 'INV-1001',
        invoice_has_signature: false,
      },
      {
        id: 'stop-2',
        name: 'Harbor Cafe',
        address: '22 Pier Avenue',
        invoice_id: 'inv-2',
        invoice_number: 'INV-1002',
        invoice_has_signature: true,
      },
    ],
  },
];

const baseDeliveries = [
  {
    id: 1,
    orderId: 'ord-1',
    restaurantName: 'Blue Fin',
    status: 'delivered',
    distanceMiles: 18.5,
    stopDurationMinutes: 20,
    onTime: true,
  },
  {
    id: 2,
    orderId: 'ord-2',
    restaurantName: 'Harbor Cafe',
    status: 'delivered',
    distanceMiles: 6.5,
    stopDurationMinutes: 10,
    onTime: false,
  },
];

const baseInvoices = [
  {
    id: 'inv-1',
    invoice_number: 'INV-1001',
    customer_name: 'Blue Fin',
    total: 125,
    status: 'sent',
    created_at: '2026-04-02T00:00:00Z',
  },
];

function mockDriverWorkspace({
  routes = baseRoutes,
  dwell = [],
  deliveries = baseDeliveries,
  invoices = baseInvoices,
  settings = {},
}: {
  routes?: unknown[];
  dwell?: unknown[];
  deliveries?: unknown[];
  invoices?: unknown[];
  settings?: Record<string, unknown>;
} = {}) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/driver/routes') return routes;
    if (url === '/api/dwell') return dwell;
    if (url === '/api/deliveries') return deliveries;
    if (url === '/api/driver/invoices') return invoices;
    if (url === '/api/settings/company') return settings;
    return null;
  });
}

describe('DriverPage', () => {
  let watchPositionMock: ReturnType<typeof vi.fn>;
  let clearWatchMock: ReturnType<typeof vi.fn>;
  let geoSuccess: ((position: GeolocationPosition) => Promise<void>) | null;

  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('nr_token', 'driver-token');
    localStorage.setItem('nr_user', JSON.stringify({ name: 'Fallback Driver' }));

    geoSuccess = null;
    watchPositionMock = vi.fn((success: (position: GeolocationPosition) => Promise<void>) => {
      geoSuccess = success;
      return 42;
    });
    clearWatchMock = vi.fn();
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: watchPositionMock,
        clearWatch: clearWatchMock,
      },
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      lineWidth: 0,
      lineCap: 'round',
      lineJoin: 'round',
      strokeStyle: '#0f172a',
      fillStyle: '#ffffff',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 320,
      height: 224,
      left: 0,
      top: 0,
      right: 320,
      bottom: 224,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,signature');
  });

  it('renders workspace data, switches tabs, and marks a stop as arrived', async () => {
    mockDriverWorkspace();
    sendWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/stops/stop-1/arrive') {
        return {
          id: 'dwell-1',
          stopId: 'stop-1',
          routeId: 'route-1',
          arrivedAt: '2026-04-03T12:00:00Z',
        };
      }
      return null;
    });

    render(<DriverPage />);

    expect(await screen.findByText('North Route')).toBeInTheDocument();
    expect(screen.getByText('Blue Fin')).toBeInTheDocument();
    expect(screen.getByText(/Invoice INV-1001/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'analytics' }));
    expect(await screen.findByText('25.0 mi')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'notes' }));
    expect(await screen.findByText('Use the back entrance.')).toBeInTheDocument();
    expect(screen.getByText('1357')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'route' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Arrive' })[0]);

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/stops/stop-1/arrive', 'POST', { routeId: 'route-1' });
    });
    expect(await screen.findByText(/Arrived:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Depart' })).toBeInTheDocument();
  });

  it('starts and stops location sync after a successful geolocation update', async () => {
    mockDriverWorkspace();
    sendWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/driver/location') return {};
      return null;
    });

    render(<DriverPage />);

    expect(await screen.findByText('North Route')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start Location Sync' }));

    expect(watchPositionMock).toHaveBeenCalledTimes(1);
    expect(geoSuccess).not.toBeNull();

    await act(async () => {
      await geoSuccess?.({
        coords: {
          latitude: 34.1,
          longitude: -118.2,
          heading: 180,
          speed: 5,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/driver/location', 'PATCH', {
        lat: 34.1,
        lng: -118.2,
        heading: 180,
        speed_mph: 11.184700000000001,
      });
    });
    expect(screen.getByText(/Location synced at/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop Sync' }));
    expect(clearWatchMock).toHaveBeenCalledWith(42);
    expect(screen.getByText('Location sync idle')).toBeInTheDocument();
  });

  it('requires a signature before departure when company settings enforce it', async () => {
    mockDriverWorkspace({
      dwell: [
        {
          id: 'dwell-1',
          stopId: 'stop-1',
          routeId: 'route-1',
          arrivedAt: '2026-04-03T12:00:00Z',
        },
      ],
      settings: { forceDriverSignature: true },
    });

    render(<DriverPage />);

    expect(await screen.findByText('North Route')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Depart' }));

    expect(await screen.findByText('Capture Customer Signature')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Signature' }));

    expect(await screen.findByText('Please capture a customer signature first.')).toBeInTheDocument();
    expect(sendWithAuthMock).not.toHaveBeenCalledWith('/api/stops/stop-1/depart', 'POST', expect.anything());
  });

  it('surfaces workspace loading errors from failed API calls', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/driver/routes') throw new Error('Routes service unavailable');
      if (url === '/api/dwell') return [];
      if (url === '/api/deliveries') return [];
      if (url === '/api/driver/invoices') return [];
      if (url === '/api/settings/company') return {};
      return null;
    });

    render(<DriverPage />);

    expect(await screen.findByText('Routes service unavailable')).toBeInTheDocument();
    expect(screen.getByText('No route assigned for today')).toBeInTheDocument();
  });
});
