import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './OrdersPage';

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

function renderOrdersPage() {
  return render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>
  );
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
      if (url === '/api/inventory') return [];
      if (url === '/api/customers') return [{ id: 'cust-1', company_name: 'Oceanview Market', billing_email: 'buyer@oceanview.test', address: '123 Harbor St' }];
      return [];
    });
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

    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[comboboxes.length - 1], { target: { value: 'pending' } });

    await waitFor(() => {
      expect(screen.getByText('ORD-001')).toBeInTheDocument();
      expect(screen.queryByText('ORD-002')).not.toBeInTheDocument();
    });
  });

  it('shows an empty-state row when no orders match the current filters', async () => {
    renderOrdersPage();

    expect(await screen.findByText('No orders match the current filters.')).toBeInTheDocument();
  });

  it('autofills customer delivery details and submits a delivery order', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ id: 'new-order-id' });

    renderOrdersPage();
    await screen.findByRole('button', { name: 'Create Order' });

    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));
    expect(await screen.findByText('Customer name is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview' } });
    fireEvent.mouseDown(await screen.findByText('Oceanview Market'));
    expect(screen.getByDisplayValue('buyer@oceanview.test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Harbor St')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));
    expect(await screen.findByText('Add at least one order item.')).toBeInTheDocument();

    const productInput = screen.getByPlaceholderText('Atlantic Salmon');
    fireEvent.change(productInput, { target: { value: 'Atlantic Salmon' } });
    const lineRow = productInput.closest('tr');
    if (!lineRow) throw new Error('Expected order line row');
    fireEvent.change(within(lineRow).getAllByRole('spinbutton')[0], { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));

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

  it('submits pickup orders without a delivery address', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ id: 'pickup-order-id' });

    renderOrdersPage();
    await screen.findByRole('button', { name: 'Create Order' });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview' } });
    fireEvent.mouseDown(await screen.findByText('Oceanview Market'));
    fireEvent.change(screen.getByDisplayValue('Delivery'), { target: { value: 'pickup' } });

    const productInput = screen.getByPlaceholderText('Atlantic Salmon');
    fireEvent.change(productInput, { target: { value: 'Atlantic Salmon' } });
    const lineRow = productInput.closest('tr');
    if (!lineRow) throw new Error('Expected order line row');
    fireEvent.change(within(lineRow).getAllByRole('spinbutton')[0], { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));

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

  it('surfaces failed API calls while loading orders', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) throw new Error('Orders API down');
      if (url === '/api/inventory' || url === '/api/customers') return [];
      return [];
    });

    renderOrdersPage();

    expect(await screen.findByText('Orders API down')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Editing ORD-100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Blue Fin')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Call on arrival'), { target: { value: 'Leave at front desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Order' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Weights' }));
    expect(await screen.findByText(/Capture Actual Weights/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('0.000'), { target: { value: '10.250' } });
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
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

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
