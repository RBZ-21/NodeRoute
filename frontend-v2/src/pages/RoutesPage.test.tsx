import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutesPage } from './RoutesPage';

const { fetchWithAuthMock, sendWithAuthMock, navigateMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const baseRoutes = [
  {
    id: 'route-1',
    name: 'North Route',
    driver: 'Alex Driver',
    status: 'active',
    stop_ids: ['stop-1'],
    active_stop_ids: ['stop-1'],
    notes: 'Morning run',
    created_at: '2026-04-10T00:00:00Z',
  },
];

const baseStops = [
  { id: 'stop-1', name: 'Blue Fin', address: '1 Dock St', notes: 'Order ORD-100' },
];

const baseOrders = [
  { id: 'order-1', order_number: 'ORD-100', customer_name: 'Blue Fin', customer_address: '1 Dock St', status: 'pending' },
  { id: 'order-2', order_number: 'ORD-101', customer_name: 'No Address Cafe', status: 'pending' },
];

const baseDrivers = [
  { id: 'driver-1', name: 'Alex Driver', email: 'alex@example.com' },
  { id: 'driver-2', name: 'Jamie Driver', email: 'jamie@example.com' },
];

function mockRoutesApi({
  routes = baseRoutes,
  stops = baseStops,
  orders = baseOrders,
  drivers = baseDrivers,
}: {
  routes?: unknown[];
  stops?: unknown[];
  orders?: unknown[];
  drivers?: unknown[];
} = {}) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/routes') return routes;
    if (url === '/api/stops') return stops;
    if (url === '/api/orders?status=pending') return orders;
    if (url === '/api/users') return drivers;
    return [];
  });
}

function renderRoutesPage() {
  return render(
    <MemoryRouter>
      <RoutesPage />
    </MemoryRouter>
  );
}

describe('RoutesPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    navigateMock.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockRoutesApi();
  });

  it('validates and submits route creation', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    renderRoutesPage();

    expect(await screen.findByText('North Route')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Route' }));
    expect(await screen.findByText('Route name is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Back Side'), { target: { value: 'South Route' } });
    fireEvent.change(screen.getByPlaceholderText('Assign driver'), { target: { value: 'Jamie Driver' } });
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: 'Afternoon run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes', 'POST', {
        name: 'South Route',
        driver: 'Jamie Driver',
        notes: 'Afternoon run',
        stopIds: [],
      });
    });
    expect(await screen.findByText('Route "South Route" created.')).toBeInTheDocument();
  });

  it('opens the edit panel, saves changes, and adds stops from pending orders', async () => {
    sendWithAuthMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ id: 'stop-2' })
      .mockResolvedValueOnce({});

    renderRoutesPage();

    expect(await screen.findByText('North Route')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Editing: North Route')).toBeInTheDocument();

    const routeNameInput = screen.getByDisplayValue('North Route');
    fireEvent.change(routeNameInput, { target: { value: 'Updated Route' } });
    fireEvent.change(screen.getByDisplayValue('Alex Driver'), { target: { value: 'Jamie Driver' } });
    fireEvent.change(screen.getByDisplayValue('Morning run'), { target: { value: 'Updated notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'PATCH', {
        name: 'Updated Route',
        driver: 'Jamie Driver',
        notes: 'Updated notes',
      });
    });
    expect(await screen.findByText('Route updated.')).toBeInTheDocument();

    const pendingOrdersSection = screen.getByText('Add Stops from Pending Orders').closest('div');
    if (!pendingOrdersSection) throw new Error('Expected pending orders section');
    fireEvent.click(within(pendingOrdersSection).getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Stop to Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/stops', 'POST', {
        name: 'Blue Fin',
        address: '1 Dock St',
        notes: 'Order ORD-100',
      });
    });
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'PATCH', {
        stopIds: ['stop-1', 'stop-2'],
        activeStopIds: ['stop-1', 'stop-2'],
      });
    });
    expect(await screen.findByText('1 stop added to route.')).toBeInTheDocument();
  });

  it('filters the route list and deletes a route after confirmation', async () => {
    mockRoutesApi({
      routes: [
        ...baseRoutes,
        { id: 'route-2', name: 'Completed Route', driver: 'Jamie Driver', status: 'completed', stop_ids: [], active_stop_ids: [], created_at: '2026-04-09T00:00:00Z' },
      ],
    });
    sendWithAuthMock.mockResolvedValueOnce({});

    renderRoutesPage();

    expect(await screen.findByText('North Route')).toBeInTheDocument();
    expect(screen.getByText('Completed Route')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'completed' } });
    await waitFor(() => {
      expect(screen.queryByText('North Route')).not.toBeInTheDocument();
      expect(screen.getByText('Completed Route')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('Completed'), { target: { value: 'all' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'DELETE');
    });
    expect(await screen.findByText('Route deleted.')).toBeInTheDocument();
  });
});
