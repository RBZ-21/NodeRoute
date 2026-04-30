import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoicesPage } from './InvoicesPage';

const { fetchWithAuthMock, navigateMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  navigateMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
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
    if (url.startsWith('/api/invoices/inv-1/pdf')) return { url: 'https://example.com/inv-1.pdf' };
    if (url.startsWith('/api/invoices')) return baseInvoices;
    return [];
  });
}

describe('InvoicesPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    navigateMock.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('open', vi.fn());
    mockInvoicesApi();
  });

  it('renders invoice data, filters by status, and opens related order navigation', async () => {
    render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('INV-100')).toBeInTheDocument();
    expect(screen.getAllByText('$125.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'paid' } });
    await waitFor(() => {
      expect(screen.queryByText('INV-100')).not.toBeInTheDocument();
      expect(screen.getByText('INV-200')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('Paid'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'ORD-100' }));
    expect(navigateMock).toHaveBeenCalledWith('/orders?customerId=cust-1');
  });

  it('supports PDF viewing, reminders, mark paid, and voiding', async () => {
    sendWithAuthMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('INV-100')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'View PDF' })[0]);
    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/invoices/inv-1/pdf');
    });
    expect(window.open).toHaveBeenCalledWith('https://example.com/inv-1.pdf', '_blank', 'noopener,noreferrer');

    fireEvent.click(screen.getAllByRole('button', { name: 'Send Reminder' })[0]);
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/invoices/inv-1/remind', 'POST');
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Mark Paid' })[0]);
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/invoices/inv-1', 'PATCH', { status: 'paid' });
    });
    expect(await screen.findByText('Invoice INV-100 marked as paid.')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Void Invoice' })[0]);
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/invoices/inv-1', 'PATCH', { status: 'void' });
    });
  });
});
