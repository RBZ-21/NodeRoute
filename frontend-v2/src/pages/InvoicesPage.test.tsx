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
    estimated_weight_pending: true,
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
    const statusSelect = screen.getAllByRole('combobox')[screen.getAllByRole('combobox').length - 1] as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'paid' } });
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

  it('marks an invoice paid from the invoice table for check payments', async () => {
    sendWithAuthMock.mockResolvedValueOnce({
      id: 'inv-1',
      invoice_number: 'INV-100',
      status: 'paid',
      paid_date: '2026-05-18T13:00:00.000Z',
    });

    renderInvoicesPage();

    expect(await screen.findByText('INV-100')).toBeInTheDocument();

    const paidButtons = screen.getAllByRole('button', { name: 'PAID' });
    fireEvent.click(paidButtons[0]);

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/invoices/inv-1', 'PATCH', { status: 'paid' });
    });
    expect(await screen.findByText('Invoice INV-100 marked paid.')).toBeInTheDocument();
  });

  it('resends only the invoice email for the clicked row', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ message: 'Invoice emailed successfully' });

    renderInvoicesPage();

    expect(await screen.findByText('INV-100')).toBeInTheDocument();

    const resendButtons = screen.getAllByRole('button', { name: 'Resend Email' });
    fireEvent.click(resendButtons[1]);

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledTimes(1);
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/invoices/inv-2/resend', 'POST');
    });
    expect(sendWithAuthMock).not.toHaveBeenCalledWith('/api/invoices/inv-1/resend', 'POST');
    expect(await screen.findByText('Invoice INV-200 emailed.')).toBeInTheDocument();
  });

  it('blocks printing while final weights are still pending', async () => {
    renderInvoicesPage();

    expect(await screen.findByText('INV-100')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'View / Edit' })[0]);
    expect(await screen.findByRole('heading', { name: 'INV-100' })).toBeInTheDocument();
    expect(screen.getByText('Waiting on final weights')).toBeInTheDocument();
    expect(screen.getByText(/Print is locked for this invoice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print / Save PDF' })).toBeDisabled();
  });
});
