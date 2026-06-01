import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutesPage } from './RoutesPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock, navigateMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
  getUserRole: () => 'admin',
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
  { id: 'stop-2', name: 'Harbor Wholesale', address: '77 Pier Ave', notes: 'Will call' },
];

const baseOrders = [
  { id: 'order-1', order_number: 'ORD-100', customer_name: 'Blue Fin', customer_address: '1 Dock St', status: 'pending' },
  { id: 'order-2', order_number: 'ORD-101', customer_name: 'No Address Cafe', status: 'pending' },
];

const baseDrivers = [
  { id: 'driver-1', name: 'Alex Driver', email: 'alex@example.com' },
  { id: 'driver-2', name: 'Jamie Driver', email: 'jamie@example.com' },
];

const baseCustomers = [
  { id: 'cust-1', company_name: 'Blue Fin', address: '1 Dock St' },
  { id: 'cust-2', company_name: 'Harbor Wholesale', address: '77 Pier Ave' },
];

function mockRoutesApi({
  routes = baseRoutes,
  stops = baseStops,
  orders = baseOrders,
  drivers = baseDrivers,
  customers = baseCustomers,
}: {
  routes?: unknown[];
  stops?: unknown[];
  orders?: unknown[];
  drivers?: unknown[];
  customers?: unknown[];
} = {}) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/routes') return routes;
    if (url === '/api/stops') return stops;
    if (url === '/api/orders?status=pending') return orders;
    if (url === '/api/users') return drivers;
    if (url === '/api/customers') return customers;
    return [];
  });
}

function renderRoutesPage() {
  return renderWithQueryClient(<RoutesPage />, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });
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

    expect(await screen.findByText('North Route')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create Route' }));
    expect(await screen.findByText('Route name is required.')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Back Side'), { target: { value: 'South Route' } });
    fireEvent.change(screen.getByPlaceholderText('Assign driver'), { target: { value: 'Jamie Driver' } });
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: 'Afternoon run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes', 'POST', {
        name: 'South Route',
        driver: 'Jamie Driver',
        driverId: 'driver-2',
        notes: 'Afternoon run',
        stopIds: [],
      });
    });
    expect(await screen.findByText('Route "South Route" created.')).toBeTruthy();
  });

  it('opens the edit panel, saves changes, adds a stop from a customer, and adds stops from pending orders', async () => {
    mockRoutesApi({
      orders: [
        { id: 'order-3', order_number: 'ORD-102', customer_name: 'Dockside Grill', customer_address: '9 Bay Rd', status: 'pending' },
      ],
    });
    sendWithAuthMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ id: 'stop-4' })
      .mockResolvedValueOnce({});

    renderRoutesPage();

    expect(await screen.findByText('North Route')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Editing: North Route')).toBeTruthy();

    const routeNameInput = screen.getByDisplayValue('North Route');
    fireEvent.change(routeNameInput, { target: { value: 'Updated Route' } });
    fireEvent.change(screen.getByDisplayValue('Alex Driver'), { target: { value: 'Jamie Driver' } });
    fireEvent.change(screen.getByDisplayValue('Morning run'), { target: { value: 'Updated notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'PATCH', {
        name: 'Updated Route',
        driver: 'Jamie Driver',
        driverId: 'driver-2',
        notes: 'Updated notes',
      });
    });
    expect(await screen.findByText('Route updated.')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search customers or orders…'), { target: { value: 'Harbor' } });
    fireEvent.mouseDown(await screen.findByText('Harbor Wholesale'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'PATCH', {
        stopIds: ['stop-1', 'stop-2'],
        activeStopIds: ['stop-1', 'stop-2'],
      });
    });
    expect(await screen.findByText('"Harbor Wholesale" added to route.')).toBeTruthy();

    const pendingOrdersSection = screen.getByText('Batch Add from Pending Orders').closest('div');
    if (!pendingOrdersSection) throw new Error('Expected pending orders section');
    fireEvent.click(within(pendingOrdersSection).getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Stop to Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/stops', 'POST', {
        name: 'Dockside Grill',
        address: '9 Bay Rd',
        notes: 'Order ORD-102',
      });
    });
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'PATCH', {
        stopIds: ['stop-1', 'stop-2', 'stop-4'],
        activeStopIds: ['stop-1', 'stop-2', 'stop-4'],
      });
    });
    expect(await screen.findByText('1 stop added.')).toBeTruthy();
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

    expect(await screen.findByText('North Route')).toBeTruthy();
    expect(screen.getByText('Completed Route')).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'completed' } });
    await waitFor(() => {
      expect(screen.queryByText('North Route')).toBeNull();
      expect(screen.getByText('Completed Route')).toBeTruthy();
    });

    fireEvent.change(screen.getByDisplayValue('Completed'), { target: { value: 'all' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'DELETE');
    });
    expect(await screen.findByText('Route deleted.')).toBeTruthy();
  });

  it('dispatches a pending route and explains that ETA is now allowed to go live', async () => {
    mockRoutesApi({
      routes: [
        { id: 'route-3', name: 'Dock Run', driver: 'Jamie Driver', status: 'pending', stop_ids: [], active_stop_ids: [], created_at: '2026-04-11T00:00:00Z' },
      ],
    });
    sendWithAuthMock.mockResolvedValueOnce({});

    renderRoutesPage();

    expect(await screen.findByText('Dock Run')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch Route' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-3', 'PATCH', {
        status: 'active',
        dispatched_at: expect.any(String),
      });
    });
    expect(await screen.findByText(/marked as departed/i)).toBeTruthy();
  });

  it('cancels a dispatched route so ETA tracking pauses', async () => {
    mockRoutesApi({
      routes: [
        {
          id: 'route-4',
          name: 'Lunch Run',
          driver: 'Alex Driver',
          status: 'active',
          dispatched_at: '2026-04-11T12:00:00Z',
          stop_ids: [],
          active_stop_ids: [],
          created_at: '2026-04-11T00:00:00Z',
        },
      ],
    });
    sendWithAuthMock.mockResolvedValueOnce({});

    renderRoutesPage();

    expect(await screen.findByText('Lunch Run')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Dispatch' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-4', 'PATCH', {
        status: 'pending',
        dispatched_at: null,
      });
    });
    expect(await screen.findByText(/Dispatch cancelled/i)).toBeTruthy();
  });

  it('applies an AI driver suggestion as a linked driver user assignment', async () => {
    sendWithAuthMock
      .mockResolvedValueOnce({
        assignments: [
          {
            route_id: 'route-1',
            route_name: 'North Route',
            recommended_driver_name: 'Jamie Driver',
            reasoning: 'Least-loaded driver.',
            confidence: 'high',
          },
        ],
        unassignable_routes: [],
        summary: '1 route suggested.',
      })
      .mockResolvedValueOnce({});

    renderRoutesPage();

    expect(await screen.findByText('North Route')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest Assignments' }));

    expect(await screen.findByText('Least-loaded driver.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/routes/route-1', 'PATCH', {
        driver: 'Jamie Driver',
        driverId: 'driver-2',
      });
    });
    expect(await screen.findByText('Assigned Jamie Driver to the route.')).toBeTruthy();
  });
});
