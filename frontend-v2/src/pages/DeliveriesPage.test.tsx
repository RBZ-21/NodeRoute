import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveriesPage } from './DeliveriesPage';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

const today = new Date().toISOString();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function toDateInputValue(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const baseDeliveries = [
  {
    id: 1,
    userFacingId: 'DEL-100',
    orderDbId: 'ord-db-1',
    orderId: 'ORD-100',
    restaurantName: 'Blue Fin',
    driverName: 'Alex Driver',
    status: 'in-transit',
    routeId: 'route-1',
    expectedWindowEnd: today,
    createdAt: today,
    lat: 34.1,
    lng: -118.2,
  },
  {
    id: 2,
    userFacingId: 'DEL-200',
    orderDbId: 'ord-db-2',
    orderId: 'ORD-200',
    restaurantName: 'Harbor Cafe',
    driverName: 'Jamie Driver',
    status: 'delivered',
    routeId: null,
    expectedWindowEnd: yesterday,
    createdAt: yesterday,
    lat: 40.7,
    lng: -74,
  },
];

function mockDeliveriesApi(deliveries = baseDeliveries) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/deliveries') return deliveries;
    return [];
  });
}

describe('DeliveriesPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    mockDeliveriesApi();
  });

  it('renders summaries and applies the current status/date filters', async () => {
    const { container } = render(<DeliveriesPage />);

    expect(await screen.findByText('DEL-100')).toBeInTheDocument();
    expect(screen.getByText('DEL-200')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'completed' } });

    await waitFor(() => {
      expect(screen.queryByText('DEL-100')).not.toBeInTheDocument();
      expect(screen.getByText('DEL-200')).toBeInTheDocument();
    });

    const dateInputs = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    if (dateInputs.length !== 2) throw new Error('Expected start and end date inputs');
    fireEvent.change(dateInputs[0], { target: { value: toDateInputValue(today) } });
    fireEvent.change(dateInputs[1], { target: { value: toDateInputValue(today) } });

    await waitFor(() => {
      expect(screen.queryByText('DEL-200')).not.toBeInTheDocument();
      expect(screen.getByText('No deliveries found for the selected filters.')).toBeInTheDocument();
    });
  });

  it('updates delivery status and refreshes the dispatch feed', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    render(<DeliveriesPage />);

    const blueFinRow = (await screen.findByText('DEL-100')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin delivery row');

    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/deliveries/ord-db-1/status', 'PATCH', {
        status: 'delivered',
      });
    });
    expect(await screen.findByText('Updated ORD-100 to delivered.')).toBeInTheDocument();
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces delivery feed and status update failures', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/deliveries') throw new Error('Dispatch feed unavailable');
      return [];
    });

    const { unmount } = render(<DeliveriesPage />);

    expect(await screen.findByText('Dispatch feed unavailable')).toBeInTheDocument();
    unmount();

    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockRejectedValueOnce(new Error('Status service unavailable'));
    mockDeliveriesApi();

    render(<DeliveriesPage />);

    const blueFinRow = (await screen.findByText('DEL-100')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin delivery row');

    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'Active' }));
    expect(await screen.findByText('Status service unavailable')).toBeInTheDocument();
  });
});
