import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesRepPage } from './SalesRepPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

function renderSalesRepPage() {
  return renderWithQueryClient(<SalesRepPage />);
}

describe('SalesRepPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/sales-reps/customers') {
        return [
          {
            id: 'cust-1',
            company_name: 'Blue Harbor Grill',
            email: 'buyer@example.com',
            phone_number: '555-0100',
            payment_terms: 'Net 14',
          },
        ];
      }
      if (url === '/api/sales-reps/visit-logs') return [];
      if (url === '/api/sales-reps/upsell-alerts') {
        return [
          {
            customer_id: 'cust-1',
            customer_name: 'Blue Harbor Grill',
            missing_items: null,
            alert: null,
          },
        ];
      }
      if (url === '/api/sales-reps/order-history/cust-1') {
        return [
          {
            id: 'order-1',
            created_at: '2026-05-01T12:00:00.000Z',
            status: 'delivered',
            items: [null, { description: 'Halibut', quantity: 2 }],
            total: null,
          },
        ];
      }
      return [];
    });
  });

  it('renders nullable Sales Rep API rows without tripping the app error boundary', async () => {
    renderSalesRepPage();

    expect(await screen.findByText('Sales Rep Hub')).toBeInTheDocument();
    expect(await screen.findByText('Blue Harbor Grill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Upsell Alerts' }));
    expect(await screen.findByText('Blue Harbor Grill')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'My Customers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Order History' }));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/sales-reps/order-history/cust-1');
    });
    expect(await screen.findByText('Halibut x2')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    const orderRow = rows[rows.length - 1];
    expect(within(orderRow).getByText('—')).toBeInTheDocument();
  });
});
