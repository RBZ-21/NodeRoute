import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancialsPage } from './FinancialsPage';

const { fetchWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

describe('FinancialsPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
  });

  it('shows receivables by customer using all open unpaid invoice statuses', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/invoices') {
        return [
          {
            id: 'inv-1',
            invoice_number: 'INV-1001',
            customer_name: 'Blue Fin',
            total: 100,
            status: 'pending',
            created_at: '2026-05-01T10:00:00Z',
            due_date: '2026-05-15',
          },
          {
            id: 'inv-2',
            invoice_number: 'INV-1002',
            customer_name: 'Blue Fin',
            total: 25,
            status: 'overdue',
            created_at: '2026-04-20T10:00:00Z',
            due_date: '2026-05-01',
          },
          {
            id: 'inv-3',
            invoice_number: 'INV-1003',
            customer_name: 'Harbor Cafe',
            total: 80,
            status: 'sent',
            created_at: '2026-05-02T10:00:00Z',
          },
          {
            id: 'inv-4',
            invoice_number: 'INV-1004',
            customer_name: 'Paid Account',
            total: 40,
            status: 'paid',
            created_at: '2026-05-03T10:00:00Z',
          },
        ];
      }
      if (url === '/api/purchase-orders') return [];
      return [];
    });

    render(<FinancialsPage />);

    expect(await screen.findByText('Accounts Receivable')).toBeInTheDocument();
    expect(screen.getByText('$205.00')).toBeInTheDocument();
    expect(screen.getByText('Blue Fin')).toBeInTheDocument();
    expect(screen.getByText('Harbor Cafe')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    expect(screen.queryByText('Paid Account')).not.toBeInTheDocument();
  });
});
