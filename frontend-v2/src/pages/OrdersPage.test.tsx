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
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/orders')) return [];
      if (url === '/api/inventory') return [];
      if (url === '/api/customers') return [];
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

  it('validates the add/edit order form and submits a happy-path create request', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ id: 'new-order-id' });

    renderOrdersPage();
    await screen.findByRole('button', { name: 'Create Order' });

    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));
    expect(await screen.findByText('Customer name is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview Market' } });
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
          items: [expect.objectContaining({ name: 'Atlantic Salmon' })],
        })
      );
    });
    expect(await screen.findByText('Order created.')).toBeInTheDocument();
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
});
