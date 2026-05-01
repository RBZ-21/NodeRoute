import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';

const { fetchWithAuthMock, getUserRoleMock, navigateMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  getUserRoleMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  getUserRole: getUserRoleMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderDashboardPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    getUserRoleMock.mockReset();
    navigateMock.mockReset();
    getUserRoleMock.mockReturnValue('admin');
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
          { id: 2, orderId: 'ORD-2', restaurantName: 'Harbor Cafe', driverName: 'Jamie', status: 'in-transit', deliveryDoor: 'Front', distanceMiles: 3.2, routeId: 'route-1', createdAt: '2026-04-11T00:00:00Z' },
        ];
      }
      if (url === '/api/drivers') {
        return [
          { id: 'd1', name: 'Alex Driver', status: 'on-duty', totalStopsToday: 10, milesToday: 42, avgStopMinutes: 14, avgSpeedMph: 31, onTimeRate: 96 },
          { id: 'd2', name: 'Jamie', status: 'off-duty', totalStopsToday: 4, milesToday: 15, avgStopMinutes: 11, avgSpeedMph: 27, onTimeRate: 88 },
        ];
      }
      if (url === '/api/routes') {
        return [
          { id: 'route-1', name: 'North Route', driver: 'Alex Driver', stop_ids: ['s1', 's2'], active_stop_ids: ['s1', 's2'], notes: 'Keep seafood cold.', created_at: '2026-04-10T00:00:00Z' },
        ];
      }
      if (url === '/api/orders') {
        return [
          {
            id: 'o1',
            order_number: 'ORD-200',
            customer_name: 'Blue Fin',
            customer_id: 'cust-1',
            status: 'pending',
            created_at: '2026-04-11T00:00:00Z',
            items: [{ is_catch_weight: true, actual_weight: null }],
          },
        ];
      }
      if (url === '/api/ops/vendor-purchase-orders') {
        return [
          { id: 'po1', status: 'open', total_ordered_cost: 1200 },
          { id: 'po2', status: 'backordered', total_ordered_cost: 800 },
        ];
      }
      if (url === '/api/reporting/sales-summary?preset=daily') {
        return {
          generated_at: '2026-05-01T12:00:00.000Z',
          filters: { preset: 'daily', start: '2026-05-01T00:00:00.000Z', end: '2026-05-01T23:59:59.999Z', item: null },
          overview: {
            total_sales: 1240,
            delivery_sales: 910,
            pickup_sales: 330,
            unknown_sales: 0,
            invoice_count: 4,
            order_count: 5,
            average_invoice: 310,
            item_count: 2,
          },
          items: [
            {
              key: 'lob-001',
              label: 'Lobster',
              item_number: 'LOB-001',
              qty: 14,
              revenue: 700,
              invoice_count: 3,
              delivery_revenue: 520,
              pickup_revenue: 180,
            },
            {
              key: 'sal-001',
              label: 'Atlantic Salmon',
              item_number: 'SAL-001',
              qty: 9,
              revenue: 540,
              invoice_count: 2,
              delivery_revenue: 390,
              pickup_revenue: 150,
            },
          ],
          available_items: [
            { key: 'lob-001', label: 'Lobster', item_number: 'LOB-001' },
            { key: 'sal-001', label: 'Atlantic Salmon', item_number: 'SAL-001' },
          ],
        };
      }
      return [];
    });
  });

  it('renders admin dashboard data and navigates from command buttons', async () => {
    renderDashboardPage();

    expect(await screen.findByText('Operational Snapshot')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText('Alex Driver')).toBeInTheDocument();
    expect(screen.getByText('ORD-200')).toBeInTheDocument();
    expect(screen.getByText('North Route')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Orders Queue' }));
    expect(navigateMock).toHaveBeenCalledWith('/orders');

    fireEvent.click(screen.getByRole('button', { name: /ORD-200/ }));
    expect(navigateMock).toHaveBeenCalledWith('/orders?orderId=o1&action=weights');

    fireEvent.click(screen.getByRole('button', { name: 'Open Purchasing Workspace' }));
    expect(navigateMock).toHaveBeenCalledWith('/purchasing');
  });

  it('shows the dedicated driver handoff for driver users', async () => {
    getUserRoleMock.mockReturnValue('driver');

    renderDashboardPage();

    expect(await screen.findByText('Driver Workspace Lives Separately')).toBeInTheDocument();
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
  });

  it('surfaces loading errors from dashboard APIs', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/stats') throw new Error('Stats service unavailable');
      return [];
    });

    renderDashboardPage();

    expect(await screen.findByText('Stats service unavailable')).toBeInTheDocument();
  });

  it('renders the reports tab with sales summary and item rows', async () => {
    renderDashboardPage();

    expect(await screen.findByText('Operational Snapshot')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));

    expect(await screen.findByText('Sales Reports')).toBeInTheDocument();
    expect(await screen.findByText('$1,240.00')).toBeInTheDocument();
    expect(screen.getByText('$910.00')).toBeInTheDocument();
    expect(screen.getByText('$330.00')).toBeInTheDocument();
    expect(screen.getByText('Lobster')).toBeInTheDocument();
    expect(screen.getByText('#LOB-001')).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/reporting/sales-summary?preset=daily');
    });
  });
});
