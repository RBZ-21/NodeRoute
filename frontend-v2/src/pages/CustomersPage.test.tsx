import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersPage } from './CustomersPage';

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

const baseCustomers = [
  {
    id: 'cust-1',
    company_name: 'Blue Fin',
    email: 'ops@bluefin.example',
    phone: '555-0101',
    address: '1 Dock Street',
    total_orders: 12,
    outstanding_balance: 1250.5,
    status: 'active',
    credit_hold: false,
  },
  {
    id: 'cust-2',
    company_name: 'Harbor Cafe',
    email: 'chef@harbor.example',
    phone: '555-0102',
    address: '22 Pier Avenue',
    total_orders: 4,
    outstanding_balance: 220,
    status: 'inactive',
    credit_hold: true,
    credit_hold_reason: 'Past due invoices',
  },
];

function mockCustomersApi(customers = baseCustomers) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/customers') return customers;
    return [];
  });
}

function renderCustomersPage() {
  return render(
    <MemoryRouter>
      <CustomersPage />
    </MemoryRouter>
  );
}

describe('CustomersPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    navigateMock.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockCustomersApi();
  });

  it('renders customer summaries, filters the workbench, and navigates to related pages', async () => {
    renderCustomersPage();

    expect(await screen.findByText('Blue Fin')).toBeInTheDocument();
    expect(screen.getByText('Harbor Cafe')).toBeInTheDocument();
    expect(screen.getByText('$1,470.50')).toBeInTheDocument();
    expect(screen.getByText('Past due invoices')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'on-hold' } });
    await waitFor(() => {
      expect(screen.queryByText('Blue Fin')).not.toBeInTheDocument();
      expect(screen.getByText('Harbor Cafe')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Name or email'), { target: { value: 'bluefin' } });
    await waitFor(() => {
      expect(screen.getByText('No customers found for the selected filters.')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('On Hold'), { target: { value: 'all' } });
    fireEvent.change(screen.getByPlaceholderText('Name or email'), { target: { value: '' } });

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');

    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View Orders' }));
    expect(navigateMock).toHaveBeenCalledWith('/orders?customerId=cust-1');

    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View Invoices' }));
    expect(navigateMock).toHaveBeenCalledWith('/invoices?customerId=cust-1');
  });

  it('places a credit hold and reloads the customer list', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    renderCustomersPage();

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');

    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'Place Hold' }));
    expect(await screen.findByText('Place Credit Hold')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Overdue balance/i), {
      target: { value: 'Late payments over 90 days' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Place Hold' })[0]);

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/customers/cust-1/hold', 'POST', {
        reason: 'Late payments over 90 days',
      });
    });
    expect(await screen.findByText('Credit hold placed on Blue Fin.')).toBeInTheDocument();
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
  });

  it('lifts a credit hold and surfaces API failures while refreshing', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    renderCustomersPage();

    const harborRow = (await screen.findByText('Harbor Cafe')).closest('tr') as HTMLElement | null;
    if (!harborRow) throw new Error('Expected Harbor Cafe row');

    fireEvent.click(within(harborRow).getByRole('button', { name: 'Lift Hold' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/customers/cust-2/hold', 'DELETE');
    });
    expect(await screen.findByText('Credit hold lifted for Harbor Cafe.')).toBeInTheDocument();

    fetchWithAuthMock.mockRejectedValueOnce(new Error('Customer service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Customer service unavailable')).toBeInTheDocument();
  });
});
