import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './OrdersPage';
import { ToastProvider } from '../components/ui/toast';

const { fetchWithAuthMock, sendWithAuthMock, getUserRoleMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
  getUserRoleMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
  getUserRole: getUserRoleMock,
}));

function renderOrdersPage(initialEntry = '/orders') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <OrdersPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return {
    queryClient,
    ...renderResult,
    unmount: () => {
      renderResult.unmount();
      queryClient.clear();
    },
  };
}

describe('OrdersPage', () => {
  beforeEach(() => {
    getUserRoleMock.mockReturnValue('admin');
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    window.open = vi.fn(() => ({
      document: {
        write: vi.fn(),
        close: vi.fn(),
        open: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
      setTimeout: (fn: () => void) => { fn(); return 0; },
    } as unknown as Window));
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) return [];
      if (url === '/api/inventory') return [{ id: 'prod-salmon', item_number: 'SAL-01', description: 'Atlantic Salmon', cost: 12, unit: 'each' }];
      if (url === '/api/customers') return [{ id: 'cust-1', company_name: 'Oceanview Market', billing_email: 'buyer@oceanview.test', address: '123 Harbor St' }];
      return [];
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders order rows and filters them by status', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          { id: '1', order_number: 'ORD-001', customer_name: 'Blue Fin', status: 'pending', items: [{ name: 'Salmon', quantity: 2, unit_price: 10 }], created_at: '2026-04-01T00:00:00Z' },
          { id: '2', order_number: 'ORD-002', customer_name: 'Harbor Cafe', status: 'invoiced', items: [{ name: 'Tuna', quantity: 1, unit_price: 25 }], created_at: '2026-04-02T00:00:00Z' },
        ];
      }
      if (url === '/api/inventory' || url === '/api/customers') return [];
      return [];
    });

    renderOrdersPage();

    expect(await screen.findByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();

    const statusSelect = screen.getAllByRole('combobox').find((select) => (
      (select as HTMLSelectElement).value === 'all'
    ));
    if (!statusSelect) throw new Error('Expected an order status filter');
    fireEvent.change(statusSelect, { target: { value: 'pending' } });

    await waitFor(() => {
      expect(screen.getByText('ORD-001')).toBeInTheDocument();
      expect(screen.queryByText('ORD-002')).not.toBeInTheDocument();
    });
  });

  it('paginates the orders workbench after filtering', async () => {
    const manyOrders = Array.from({ length: 26 }, (_, index) => ({
      id: `order-${index + 1}`,
      order_number: `ORD-${String(index + 1).padStart(3, '0')}`,
      customer_name: `Customer ${index + 1}`,
      status: 'pending',
      items: [{ name: 'Atlantic Salmon', quantity: 1, unit_price: 12 }],
      created_at: '2026-04-01T00:00:00Z',
    }));
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) return manyOrders;
      if (url === '/api/inventory' || url === '/api/customers') return [];
      return [];
    });

    renderOrdersPage();

    expect(await screen.findByText('ORD-001')).toBeInTheDocument();
    expect(screen.queryByText('ORD-026')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('ORD-026')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Order # or customer'), { target: { value: 'ORD-026' } });
    expect(await screen.findByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('ORD-026')).toBeInTheDocument();
  });

  it('bulk-updates selected order statuses from the workbench', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          { id: '1', order_number: 'ORD-001', customer_name: 'Blue Fin', status: 'pending', items: [{ name: 'Salmon', quantity: 2, unit_price: 10 }], created_at: '2026-04-01T00:00:00Z' },
          { id: '2', order_number: 'ORD-002', customer_name: 'Harbor Cafe', status: 'pending', items: [{ name: 'Tuna', quantity: 1, unit_price: 25 }], created_at: '2026-04-02T00:00:00Z' },
        ];
      }
      if (url === '/api/inventory' || url === '/api/customers') return [];
      return [];
    });
    sendWithAuthMock.mockResolvedValue({});

    renderOrdersPage();

    expect(await screen.findByText('ORD-001')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select all visible orders'));
    fireEvent.change(screen.getByLabelText('Bulk status'), { target: { value: 'in_process' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Bulk Status' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/orders/1', 'PATCH', { status: 'in_process' });
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/orders/2', 'PATCH', { status: 'in_process' });
    });
    expect(await screen.findByText('Updated 2 order(s) to in process.')).toBeInTheDocument();
  });

  it('shows an empty-state row when no orders match the current filters', async () => {
    renderOrdersPage();

    expect(await screen.findByText('No orders match the current filters.')).toBeInTheDocument();
  });

  it('autofills customer delivery details and submits a delivery order', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ id: 'new-order-id' });

    renderOrdersPage();
    // The order form now lives inside the "+ New Order" slide-over drawer.
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));
    expect(await screen.findByText('Customer name is required.')).toBeInTheDocument();
    expect(screen.getByText('Customer email is required.')).toBeInTheDocument();
    expect(screen.getByText('Customer address is required for delivery orders.')).toBeInTheDocument();
    expect(screen.getByText('Add at least one order item with quantity greater than 0.')).toBeInTheDocument();
    expect(sendWithAuthMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview' } });
    fireEvent.mouseDown(await screen.findByText('Oceanview Market'));
    expect(screen.getByDisplayValue('buyer@oceanview.test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Harbor St')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));
    expect(await screen.findByText('Add at least one order item with quantity greater than 0.')).toBeInTheDocument();

    const productInput = screen.getByPlaceholderText('Atlantic Salmon');
    fireEvent.change(productInput, { target: { value: 'Atlantic Salmon' } });
    fireEvent.mouseDown(await screen.findByText('Atlantic Salmon'));
    const lineRow = productInput.closest('tr');
    if (!lineRow) throw new Error('Expected order line row');
    fireEvent.change(within(lineRow).getAllByRole('spinbutton')[0], { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders',
        'POST',
        expect.objectContaining({
          customerName: 'Oceanview Market',
          customerEmail: 'buyer@oceanview.test',
          customerAddress: '123 Harbor St',
          fulfillmentType: 'delivery',
          items: [expect.objectContaining({ name: 'Atlantic Salmon' })],
        })
      );
    });
    expect(await screen.findByText('Order created.')).toBeInTheDocument();
  });

  it('blocks incomplete delivery details before calling the orders API', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) return [];
      if (url === '/api/inventory') return [{ id: 'prod-salmon', item_number: 'SAL-01', description: 'Atlantic Salmon', cost: 12, unit: 'each' }];
      if (url === '/api/customers') return [];
      return [];
    });

    renderOrdersPage();
    // The order form now lives inside the "+ New Order" slide-over drawer.
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Walkup Cafe' } });
    fireEvent.change(screen.getByPlaceholderText('buyer@customer.com'), { target: { value: 'orders@walkup.test' } });
    const productInput = screen.getByPlaceholderText('Atlantic Salmon');
    fireEvent.change(productInput, { target: { value: 'Atlantic Salmon' } });
    fireEvent.mouseDown(await screen.findByText('Atlantic Salmon'));
    const lineRow = productInput.closest('tr');
    if (!lineRow) throw new Error('Expected order line row');
    fireEvent.change(within(lineRow).getAllByRole('spinbutton')[0], { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));

    expect(await screen.findByText('Customer address is required for delivery orders.')).toBeInTheDocument();
    expect(sendWithAuthMock).not.toHaveBeenCalled();
  });

  it('hydrates address and email when the typed customer name exactly matches a saved customer', async () => {
    renderOrdersPage();
    // The order form now lives inside the "+ New Order" slide-over drawer.
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview Market' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('buyer@oceanview.test')).toBeInTheDocument();
      expect(screen.getByDisplayValue('123 Harbor St')).toBeInTheDocument();
    });
  });

  it('submits pickup orders without a delivery address', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ id: 'pickup-order-id' });

    renderOrdersPage();
    // The order form now lives inside the "+ New Order" slide-over drawer.
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview' } });
    fireEvent.mouseDown(await screen.findByText('Oceanview Market'));
    fireEvent.change(screen.getByDisplayValue('Delivery'), { target: { value: 'pickup' } });

    const productInput = screen.getByPlaceholderText('Atlantic Salmon');
    fireEvent.change(productInput, { target: { value: 'Atlantic Salmon' } });
    fireEvent.mouseDown(await screen.findByText('Atlantic Salmon'));
    const lineRow = productInput.closest('tr');
    if (!lineRow) throw new Error('Expected order line row');
    fireEvent.change(within(lineRow).getAllByRole('spinbutton')[0], { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders',
        'POST',
        expect.objectContaining({
          customerName: 'Oceanview Market',
          customerAddress: '',
          fulfillmentType: 'pickup',
        })
      );
    });
  });

  it('submits pound-based items with both ordered quantity and estimated weight', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) return [];
      if (url === '/api/inventory') return [{ item_number: 'LOB-1', description: 'Live Lobster', cost: 18, unit: 'lb' }];
      if (url === '/api/customers') return [{ id: 'cust-1', company_name: 'Oceanview Market', billing_email: 'buyer@oceanview.test', address: '123 Harbor St' }];
      return [];
    });
    sendWithAuthMock.mockResolvedValueOnce({ id: 'lobster-order-id' });

    renderOrdersPage();
    // The order form now lives inside the "+ New Order" slide-over drawer.
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview Market' } });
    fireEvent.change(screen.getByPlaceholderText('Atlantic Salmon'), { target: { value: 'Live Lobster' } });
    fireEvent.mouseDown(await screen.findByText('Live Lobster'));

    const row = screen.getByDisplayValue('Live Lobster').closest('tr');
    if (!row) throw new Error('Expected lobster row');
    const inputs = within(row).getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '6' } });
    fireEvent.change(inputs[1], { target: { value: '24.5' } });
    fireEvent.change(inputs[2], { target: { value: '18' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders',
        'POST',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              name: 'Live Lobster',
              unit: 'lb',
              requested_qty: 6,
              requested_weight: 24.5,
              unit_price: 18,
            }),
          ],
        })
      );
    });
  });

  it('surfaces failed API calls while loading orders', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) throw new Error('Orders API down');
      if (url === '/api/inventory' || url === '/api/customers') return [];
      return [];
    });

    renderOrdersPage();

    expect(await screen.findByText('Orders API down')).toBeInTheDocument();
  });

  it('allows selecting an out-of-stock product even when item_number is missing', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) return [];
      if (url === '/api/inventory') {
        return [
          {
            id: 'prod-halibut',
            item_number: null,
            description: 'Wild Halibut',
            cost: 22,
            unit: 'each',
            on_hand_qty: 0,
          },
        ];
      }
      if (url === '/api/customers') {
        return [{ id: 'cust-1', company_name: 'Oceanview Market', billing_email: 'buyer@oceanview.test', address: '123 Harbor St' }];
      }
      return [];
    });
    sendWithAuthMock.mockResolvedValueOnce({ id: 'halibut-order-id' });

    renderOrdersPage();
    // The order form now lives inside the "+ New Order" slide-over drawer.
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview Market' } });

    const productInput = screen.getByPlaceholderText('Atlantic Salmon');
    fireEvent.change(productInput, { target: { value: 'Wild Halibut' } });
    fireEvent.mouseDown(await screen.findByText('Wild Halibut'));

    const row = screen.getByDisplayValue('Wild Halibut').closest('tr');
    if (!row) throw new Error('Expected halibut row');
    fireEvent.change(within(row).getAllByRole('spinbutton')[0], { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders',
        'POST',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              name: 'Wild Halibut',
              product_id: 'prod-halibut',
              item_number: undefined,
            }),
          ],
        }),
      );
    });
  });

  it('fills every parsed AI intake line without waiting on timers', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) return [];
      if (url === '/api/inventory') {
        return [
          { id: 'prod-salmon', item_number: 'SAL-01', description: 'Atlantic Salmon', cost: 12, unit: 'each' },
          { id: 'prod-shrimp', item_number: 'SHR-01', description: 'White Shrimp', cost: 9, unit: 'each' },
        ];
      }
      if (url === '/api/customers') return [{ id: 'cust-1', company_name: 'Oceanview Market', billing_email: 'buyer@oceanview.test', address: '123 Harbor St' }];
      if (url.startsWith('/api/order-guides')) return { guides: [] };
      if (url.startsWith('/api/customer-messages')) return { messages: [] };
      if (url.startsWith('/api/pricing/resolve')) return { price: 12, method: 'catalog' };
      return [];
    });
    sendWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/ai/order-intake') {
        return {
          customer_name_hint: 'Oceanview Market',
          order_notes: 'Friday delivery',
          items: [
            { name: 'Atlantic Salmon', unit: 'each', amount: 2, unit_price: 12, item_number: 'SAL-01' },
            { name: 'White Shrimp', unit: 'each', amount: 3, unit_price: 9, item_number: 'SHR-01' },
          ],
        };
      }
      if (url === '/api/orders') return { id: 'ai-order-id' };
      return {};
    });

    renderOrdersPage();
    expect(await screen.findByText('No orders match the current filters.')).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Parse Customer Message/i }));
    fireEvent.change(screen.getByPlaceholderText(/Hi, can I get/i), { target: { value: 'Oceanview needs salmon and shrimp' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Parse & Fill' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Create Draft Order' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('buyer@oceanview.test')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Draft Order' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const orderCall = sendWithAuthMock.mock.calls.find(([url]) => url === '/api/orders');
    expect(orderCall?.[2]).toEqual(expect.objectContaining({
      customerName: 'Oceanview Market',
      notes: 'Friday delivery',
      items: [
        expect.objectContaining({ name: 'Atlantic Salmon', quantity: 2, unit_price: 12 }),
        expect.objectContaining({ name: 'White Shrimp', quantity: 3, unit_price: 9 }),
      ],
    }));
  });

  it('loads an order into edit mode and sends an update request', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          {
            id: 'order-1',
            order_number: 'ORD-100',
            customer_name: 'Blue Fin',
            customer_email: 'buyer@bluefin.test',
            customer_address: '1 Harbor Way',
            notes: 'Call on arrival',
            tax_enabled: true,
            tax_rate: 0.08,
            status: 'pending',
            charges: [{ key: 'fuel', value: 5, amount: 1 }],
            items: [{ name: 'Atlantic Salmon', item_number: 'SAL-01', quantity: 2, unit_price: 11, unit: 'each' }],
          },
        ];
      }
      if (url === '/api/inventory') return [{ item_number: 'SAL-01', description: 'Atlantic Salmon', cost: 11, unit: 'each' }];
      if (url === '/api/customers') return [];
      return [];
    });
    sendWithAuthMock.mockResolvedValueOnce({ id: 'order-1' });

    renderOrdersPage();

    expect(await screen.findByText('ORD-100')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Order' }));

    expect(await screen.findByText('Editing ORD-100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Blue Fin')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Call on arrival'), { target: { value: 'Leave at front desk' } });

    await waitFor(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Update Draft Order' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders/order-1',
        'PATCH',
        expect.objectContaining({
          customerName: 'Blue Fin',
          notes: 'Leave at front desk',
          items: [expect.objectContaining({ name: 'Atlantic Salmon' })],
        })
      );
    });
    expect(await screen.findByText('Order updated.')).toBeInTheDocument();
  });

  it('updates an in-process order to pound-based items and keeps it in the weight flow', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          {
            id: 'order-2',
            order_number: 'ORD-200',
            customer_name: 'Blue Fin',
            customer_email: 'buyer@bluefin.test',
            customer_address: '1 Harbor Way',
            notes: '',
            tax_enabled: false,
            tax_rate: 0.09,
            status: 'in_process',
            invoice_id: 'inv-200',
            items: [{ name: 'Lobsters', item_number: 'LOB-1', quantity: 6, unit_price: 18, unit: 'each' }],
          },
        ];
      }
      if (url === '/api/inventory') return [{ item_number: 'LOB-1', description: 'Lobsters', cost: 18, unit: 'lb' }];
      if (url === '/api/customers') return [];
      return [];
    });
    sendWithAuthMock.mockResolvedValueOnce({
      id: 'order-2',
      order_number: 'ORD-200',
      customer_name: 'Blue Fin',
      status: 'in_process',
      invoice_id: 'inv-200',
      items: [{ name: 'Lobsters', item_number: 'LOB-1', requested_qty: 6, requested_weight: 24.5, unit_price: 18, unit: 'lb' }],
    });

    renderOrdersPage();

    expect(await screen.findByText('ORD-200')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Order' }));

    const row = screen.getByDisplayValue('Lobsters').closest('tr');
    if (!row) throw new Error('Expected lobster row');
    fireEvent.change(within(row).getByDisplayValue('each'), { target: { value: 'lb' } });
    const inputs = within(row).getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '6' } });
    fireEvent.change(inputs[1], { target: { value: '24.5' } });
    fireEvent.change(inputs[2], { target: { value: '18' } });

    fireEvent.click(screen.getByRole('button', { name: 'Update Draft Order' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders/order-2',
        'PATCH',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              name: 'Lobsters',
              unit: 'lb',
              requested_qty: 6,
              requested_weight: 24.5,
              unit_price: 18,
            }),
          ],
        })
      );
    });
  });

  it('shows catch-weight actions and saves actual weights for admin users', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          {
            id: 'order-cw',
            order_number: 'ORD-CW',
            customer_name: 'Harbor Cafe',
            status: 'in_process',
            items: [
              {
                name: 'Yellowfin Tuna',
                is_catch_weight: true,
                estimated_weight: 10,
                price_per_lb: 14.5,
              },
            ],
          },
        ];
      }
      if (url === '/api/inventory') return [];
      if (url === '/api/customers') return [];
      return [];
    });
    sendWithAuthMock.mockResolvedValueOnce({
      id: 'order-cw',
      order_number: 'ORD-CW',
      customer_name: 'Harbor Cafe',
      status: 'in_process',
      items: [
        {
          name: 'Yellowfin Tuna',
          is_catch_weight: true,
          estimated_weight: 10,
          actual_weight: 10.25,
          price_per_lb: 14.5,
        },
      ],
    });

    renderOrdersPage();

    expect(await screen.findByText('ORD-CW')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Weight Pending'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Actions for ORD-CW/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Enter Weights' }));
    expect(await screen.findByText(/Weight Entry/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('lbs'), { target: { value: '10.250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders/order-cw/items/0/actual-weight',
        'PATCH',
        { actual_weight: 10.25 }
      );
    });
    expect(await screen.findByText('Actual weight saved. Order total recalculated.')).toBeInTheDocument();
  });

  it('opens weight capture when clicking the order number for a pending-weight order', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          {
            id: 'order-lb',
            order_number: 'ORD-LB',
            customer_name: 'Harbor Cafe',
            status: 'pending',
            items: [
              {
                name: 'Yellowfin Tuna',
                unit: 'lb',
                requested_weight: 12,
                unit_price: 14.5,
              },
            ],
          },
        ];
      }
      if (url === '/api/inventory') return [];
      if (url === '/api/customers') return [];
      return [];
    });

    renderOrdersPage();

    expect(await screen.findByText('ORD-LB')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /ORD-LB/ })[0]);

    expect(await screen.findByText(/Weight Entry/)).toBeInTheDocument();
  });

  it('opens the grouped weight board from dashboard-style queue links', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          {
            id: 'order-a',
            order_number: 'ORD-A',
            customer_name: 'Blue Fin',
            status: 'pending',
            items: [
              { name: 'Yellowfin Tuna', unit: 'lb', requested_weight: 12, unit_price: 14.5 },
              { name: 'Swordfish', unit: 'lb', requested_weight: 9, unit_price: 16 },
            ],
          },
          {
            id: 'order-b',
            order_number: 'ORD-B',
            customer_name: 'Harbor Cafe',
            status: 'in_process',
            items: [
              { name: 'Salmon', is_catch_weight: true, estimated_weight: 10, actual_weight: 10.25, price_per_lb: 13.75 },
            ],
          },
        ];
      }
      if (url === '/api/inventory' || url === '/api/customers') return [];
      return [];
    });

    renderOrdersPage('/orders?action=weights');

    expect(await screen.findByText('Orders Needing Weights')).toBeInTheDocument();
    expect(await screen.findByText('Yellowfin Tuna')).toBeInTheDocument();
    expect(screen.getByText('Swordfish')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('ORD-A') && content.includes('Blue Fin'))).toBeInTheDocument();
    expect(screen.queryByText('Salmon')).not.toBeInTheDocument();
  });

  it('warns about unsaved changes when closing the order drawer and keeps it open on cancel', async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);

    renderOrdersPage();
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Half-typed customer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));

    expect(confirmMock).toHaveBeenCalledWith('Discard unsaved order changes?');
    // Declining the confirm keeps the drawer (and typed value) on screen.
    expect(screen.getByDisplayValue('Half-typed customer')).toBeInTheDocument();

    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create Draft Order' })).not.toBeInTheDocument();
    });
  });

  it('closes the order drawer without a confirm prompt when the form is untouched', async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);

    renderOrdersPage();
    fireEvent.click((await screen.findAllByRole('button', { name: '+ New Order' }))[0]);
    await screen.findByRole('button', { name: 'Create Draft Order' });

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));

    expect(confirmMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create Draft Order' })).not.toBeInTheDocument();
    });
  });

  it('sends a pending order to processing and opens a print window', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) {
        return [
          {
            id: 'order-send',
            order_number: 'ORD-SEND',
            customer_name: 'Cash Customer',
            customer_address: '1 Dock St',
            status: 'pending',
            tax_enabled: false,
            tax_rate: 0.09,
            items: [{ name: 'Atlantic Salmon', quantity: 1, unit_price: 12, unit: 'each' }],
          },
        ];
      }
      if (url === '/api/inventory' || url === '/api/customers') return [];
      return [];
    });
    sendWithAuthMock.mockResolvedValueOnce({
      id: 'order-send',
      order_number: 'ORD-SEND',
      customer_name: 'Cash Customer',
      customer_address: '1 Dock St',
      status: 'in_process',
      items: [{ name: 'Atlantic Salmon', quantity: 1, unit_price: 12, unit: 'each' }],
    });

    renderOrdersPage();

    expect(await screen.findByText('ORD-SEND')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Actions for ORD-SEND/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Send to Processing' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/orders/order-send/send',
        'POST',
        { taxEnabled: false, taxRate: 0.09 }
      );
    });
    expect(window.open).toHaveBeenCalled();
    expect(await screen.findByText('Order ORD-SEND sent to processing.')).toBeInTheDocument();
  });
});
