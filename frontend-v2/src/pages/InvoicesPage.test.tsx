import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoicesPage } from './InvoicesPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

const baseInvoices = [
  {
    id: 'inv-1',
    invoice_number: 'INV-100',
    customer_name: 'Blue Fin',
    customer_id: 'cust-1',
    order_number: 'ORD-100',
    issue_date: '2026-04-01',
    due_date: '2026-04-15',
    amount: 125,
    status: 'pending',
  },
  {
    id: 'inv-2',
    invoice_number: 'INV-200',
    customer_name: 'Harbor Cafe',
    customer_id: 'cust-2',
    order_number: 'ORD-200',
    issue_date: '2026-04-02',
    due_date: '2026-04-03',
    amount: 300,
    status: 'paid',
    paid_date: '2026-04-05',
  },
];

function mockInvoicesApi() {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/invoices')) return baseInvoices;
    return [];
  });
}

describe('InvoicesPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockInvoicesApi();
  });

  function renderInvoicesPage() {
    return renderWithQueryClient(<InvoicesPage />, {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });
  }

  it('renders invoice data, filters by status, and opens the invoice detail panel', async () => {
    renderInvoicesPage();

    expect(await screen.findByText('INV-100')).toBeInTheDocument();
    expect(screen.getAllByText('$125.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'paid' } });
    await waitFor(() => {
      expect(screen.queryByText('INV-100')).not.toBeInTheDocument();
      expect(screen.getByText('INV-200')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('Paid'), { target: { value: 'all' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'View / Edit' })[0]);
    expect(await screen.findByRole('heading', { name: 'INV-100' })).toBeInTheDocument();
    expect(screen.getByText('Blue Fin', { selector: 'p' })).toBeInTheDocument();
  });

  it('supports editing and deleting an invoice', async () => {
    sendWithAuthMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    renderInvoicesPage();

    expect(await screen.findByText('INV-100')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'View / Edit' })[0]);
    expect(await screen.findByRole('heading', { name: 'INV-100' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByDisplayValue('125'), { target: { value: '150' } });
    fireEvent.change(screen.getByDisplayValue('2026-04-15'), { target: { value: '2026-04-20' } });
    fireEvent.change(screen.getAllByRole('combobox').at(-1) as HTMLSelectElement, { target: { value: 'paid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/invoices/inv-1',
        'PATCH',
        expect.objectContaining({
          amount: '150',
          dueDate: '2026-04-20',
          status: 'paid',
        }),
      );
    });
    expect(await screen.findByText('Invoice INV-100 saved.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/invoices/inv-1', 'DELETE');
    });
    expect(await screen.findByText('Invoice INV-100 deleted.')).toBeInTheDocument();
  });
});
