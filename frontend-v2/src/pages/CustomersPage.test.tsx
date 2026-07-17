import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersPage } from './CustomersPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  fetchListWithAuth: (url: string) =>
    fetchWithAuthMock(url).then((d: unknown) => {
      if (!Array.isArray(d)) throw new Error(`Expected a list response from ${url}`);
      return d;
    }),
  sendWithAuth: sendWithAuthMock,
}));

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
    if (String(url).startsWith('/api/invoices?customer_id=')) return [];
    if (/^\/api\/customers\/[^/]+\/orders$/.test(String(url))) return [];
    if (/^\/api\/customers\/[^/]+\/frequently-ordered$/.test(String(url))) {
      return { items: [], window_start: '2026-04-15T00:00:00.000Z' };
    }
    return [];
  });
}

function renderCustomersPage() {
  return renderWithQueryClient(<CustomersPage />, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });
}

describe('CustomersPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockCustomersApi();
  });

  it('renders customer summaries, filters the workbench, and opens customer detail views', async () => {
    renderCustomersPage();

    expect(await screen.findByText('Blue Fin')).toBeInTheDocument();
    expect(screen.getByText('Harbor Cafe')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getAllByText('Credit Hold').length).toBeGreaterThan(0);
    expect(screen.getByText('Past due invoices')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'credit-hold' } });
    await waitFor(() => {
      expect(screen.queryByText('Blue Fin')).not.toBeInTheDocument();
      expect(screen.getByText('Harbor Cafe')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Name, #, email...'), { target: { value: 'bluefin' } });
    await waitFor(() => {
      expect(screen.getByText('No customers found.')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('Credit Hold'), { target: { value: 'all' } });
    fireEvent.change(screen.getByPlaceholderText('Name, #, email...'), { target: { value: '' } });

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');

    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View / Edit' }));
    expect(await screen.findByRole('heading', { name: 'Blue Fin' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'invoices' }));
    expect(await screen.findByText('No invoices found for this customer.')).toBeInTheDocument();
  });

  it('paginates the customer roster after filtering', async () => {
    const manyCustomers = Array.from({ length: 26 }, (_, index) => ({
      id: `cust-${index + 1}`,
      customer_number: `C-${String(index + 1).padStart(3, '0')}`,
      company_name: `Customer ${index + 1}`,
      email: `customer${index + 1}@example.com`,
      phone: '555-0101',
      status: 'active',
      credit_hold: false,
    }));
    mockCustomersApi(manyCustomers);

    renderCustomersPage();

    expect(await screen.findByText('Customer 1')).toBeInTheDocument();
    expect(screen.queryByText('Customer 26')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Customer 26')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Name, #, email...'), { target: { value: 'Customer 26' } });
    expect(await screen.findByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Customer 26')).toBeInTheDocument();
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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Place Hold' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/customers/cust-1/hold', 'POST', {
        reason: 'Late payments over 90 days',
      });
    });
    expect(await screen.findByText('Credit hold placed on Blue Fin.')).toBeInTheDocument();
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
  });

  it('adds a customer from the customer dashboard and reloads the list', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    renderCustomersPage();

    expect(await screen.findByText('Blue Fin')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Customer' }));
    expect(await screen.findByText('Create a new customer directly from the customer dashboard.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Blue Fin Seafood'), { target: { value: 'Dockside Market' } });
    fireEvent.change(screen.getByPlaceholderText('Receiving Manager'), { target: { value: 'Jamie Smith' } });
    fireEvent.change(screen.getByPlaceholderText('ops@example.com'), { target: { value: 'dockside@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('(555) 010-0103'), { target: { value: '555-0199' } });
    fireEvent.change(screen.getByPlaceholderText('123 Dock Street'), { target: { value: '99 Harbor Way' } });
    fireEvent.change(screen.getByPlaceholderText('Net 30'), { target: { value: 'Net 15' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Customer' })[0]);

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/customers', 'POST', {
        company_name: 'Dockside Market',
        contact_name: 'Jamie Smith',
        email: 'dockside@example.com',
        phone: '555-0199',
        address: '99 Harbor Way',
        payment_terms: 'Net 15',
        status: 'active',
      });
    });
    expect(await screen.findByText('Customer Dockside Market added.')).toBeInTheDocument();
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
  });

  it('deletes a customer from the edit panel and reloads the list', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    renderCustomersPage();

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');

    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View / Edit' }));
    expect(await screen.findByRole('heading', { name: 'Blue Fin' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/customers/cust-1', 'DELETE');
    });
    expect(await screen.findByText('Blue Fin deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blue Fin' })).not.toBeInTheDocument();
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

  it('makes both new customer detail tabs available alongside the existing ones', async () => {
    renderCustomersPage();

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');
    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View / Edit' }));
    expect(await screen.findByRole('heading', { name: 'Blue Fin' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Order History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Frequently Ordered' })).toBeInTheDocument();
    // The existing tabs (including the Sales Rep Hub's own Invoices tab entry point) are untouched.
    expect(screen.getByRole('button', { name: 'info' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'delivery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'billing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'invoices' })).toBeInTheDocument();
  });

  it('shows order history for the selected customer, newest first, with a link back to the filtered Orders page', async () => {
    const orders = [
      {
        id: 'order-2',
        order_number: 'ORD-1002',
        status: 'delivered',
        created_at: '2026-07-10T12:00:00.000Z',
        items: [{ description: 'Halibut', quantity: 5, unit_price: 10 }],
        charges: [],
      },
      {
        id: 'order-1',
        order_number: 'ORD-1001',
        status: 'pending',
        created_at: '2026-07-01T12:00:00.000Z',
        items: [{ description: 'Salmon', quantity: 2, unit_price: 20 }],
        charges: [],
      },
    ];
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/customers') return baseCustomers;
      if (url === '/api/customers/cust-1/orders') return orders;
      return [];
    });

    renderCustomersPage();

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');
    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View / Edit' }));
    expect(await screen.findByRole('heading', { name: 'Blue Fin' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Order History' }));

    expect(await screen.findByText('ORD-1002')).toBeInTheDocument();
    expect(screen.getByText('ORD-1001')).toBeInTheDocument();
    expect(screen.getByText('Halibut x5')).toBeInTheDocument();
    expect(screen.getByText('Salmon x2')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();

    const orderRows = screen.getAllByRole('row').filter((row) => within(row).queryByText(/^ORD-/));
    expect(within(orderRows[0]).getByText('ORD-1002')).toBeInTheDocument();
    expect(within(orderRows[1]).getByText('ORD-1001')).toBeInTheDocument();

    const viewAllLink = screen.getByRole('link', { name: 'View all in Orders' });
    expect(viewAllLink).toHaveAttribute('href', '/orders?customerId=cust-1');
  });

  it('shows frequently ordered items as returned by the API, with the 90-day explanation', async () => {
    const frequentlyOrdered = {
      items: [
        { product_id: 'p-hal', item_number: 'HAL-001', description: 'Halibut', order_count: 5, total_quantity: 40, last_ordered_at: '2026-07-10T00:00:00.000Z' },
        { product_id: 'p-sal', item_number: 'SAL-001', description: 'Salmon', order_count: 2, total_quantity: 15, last_ordered_at: '2026-06-20T00:00:00.000Z' },
      ],
      window_start: '2026-04-15T00:00:00.000Z',
    };
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/customers') return baseCustomers;
      if (url === '/api/customers/cust-1/frequently-ordered') return frequentlyOrdered;
      return [];
    });

    renderCustomersPage();

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');
    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View / Edit' }));
    expect(await screen.findByRole('heading', { name: 'Blue Fin' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Frequently Ordered' }));

    expect(await screen.findByText(/last 90 days/i)).toBeInTheDocument();
    // Wait for the actual data-driven content (the explanatory sentence above
    // is static and renders before the fetch resolves, so it can't be used to
    // wait for the table rows).
    expect(await screen.findByText('Halibut')).toBeInTheDocument();

    const itemRows = screen.getAllByRole('row').filter((row) => within(row).queryByText(/Halibut|Salmon/));
    expect(within(itemRows[0]).getByText('Halibut')).toBeInTheDocument();
    expect(within(itemRows[0]).getByText('5')).toBeInTheDocument();
    expect(within(itemRows[0]).getByText('40')).toBeInTheDocument();
    expect(within(itemRows[1]).getByText('Salmon')).toBeInTheDocument();
  });

  it('renders loading and empty states for the new tabs without an error boundary failure', async () => {
    let resolveOrders: (value: unknown) => void = () => {};
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/customers') return baseCustomers;
      if (url === '/api/customers/cust-1/orders') {
        return new Promise((resolve) => {
          resolveOrders = resolve;
        });
      }
      if (url === '/api/customers/cust-1/frequently-ordered') {
        return { items: [], window_start: '2026-04-15T00:00:00.000Z' };
      }
      return [];
    });

    renderCustomersPage();

    const blueFinRow = (await screen.findByText('Blue Fin')).closest('tr') as HTMLElement | null;
    if (!blueFinRow) throw new Error('Expected Blue Fin row');
    fireEvent.click(within(blueFinRow).getByRole('button', { name: 'View / Edit' }));
    expect(await screen.findByRole('heading', { name: 'Blue Fin' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Order History' }));
    expect(screen.getByRole('status', { name: 'Loading order history' })).toBeInTheDocument();

    resolveOrders([]);
    expect(await screen.findByText('No orders found for this customer.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Frequently Ordered' }));
    expect(await screen.findByText(/No frequently ordered items/i)).toBeInTheDocument();
  });
});
