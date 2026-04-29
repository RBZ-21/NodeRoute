import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerPortalPage } from './CustomerPortalPage';

const {
  clearPortalSessionMock,
  fetchPortalBlobMock,
  fetchWithPortalAuthMock,
  getPortalTokenMock,
  sendWithPortalAuthMock,
  setPortalTokenMock,
} = vi.hoisted(() => ({
  clearPortalSessionMock: vi.fn(),
  fetchPortalBlobMock: vi.fn(),
  fetchWithPortalAuthMock: vi.fn(),
  getPortalTokenMock: vi.fn(),
  sendWithPortalAuthMock: vi.fn(),
  setPortalTokenMock: vi.fn(),
}));

vi.mock('../lib/portalApi', () => ({
  clearPortalSession: clearPortalSessionMock,
  fetchPortalBlob: fetchPortalBlobMock,
  fetchWithPortalAuth: fetchWithPortalAuthMock,
  getPortalToken: getPortalTokenMock,
  sendWithPortalAuth: sendWithPortalAuthMock,
  setPortalToken: setPortalTokenMock,
}));

function mockJsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
  } as Response);
}

describe('CustomerPortalPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    getPortalTokenMock.mockReturnValue('');
    fetchWithPortalAuthMock.mockReset();
    sendWithPortalAuthMock.mockReset();
    setPortalTokenMock.mockReset();
    clearPortalSessionMock.mockReset();
  });

  it('supports the auth flow from email entry to code entry to authenticated state', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/portal/auth') {
        return mockJsonResponse({ challengeId: 'challenge-123', maskedEmail: 'b***@example.com' });
      }
      if (url === '/api/portal/verify') {
        getPortalTokenMock.mockReturnValue('portal-token');
        fetchWithPortalAuthMock.mockImplementation(async (apiUrl: string) => {
          if (apiUrl === '/api/portal/me') return { email: 'buyer@example.com', name: 'Blue Fin' };
          if (apiUrl === '/api/portal/orders') return [{ id: 'o1', order_number: 'ORD-9', customer_name: 'Blue Fin', status: 'pending', created_at: '2026-04-01T00:00:00Z' }];
          if (apiUrl === '/api/portal/invoices') return [{ id: 'i1', invoice_number: 'INV-9', total: 125, status: 'sent', created_at: '2026-04-02T00:00:00Z' }];
          if (apiUrl === '/api/portal/contact') return { email: 'buyer@example.com', name: 'Blue Fin' };
          if (apiUrl === '/api/portal/inventory') return [];
          if (apiUrl === '/api/portal/payments/config') return { enabled: false, balance: { openBalance: 125, openInvoiceCount: 1, invoiceCount: 1 }, payment_methods: [] };
          if (apiUrl === '/api/portal/payments/profile') return { payment_methods: [], autopay: { enabled: false }, balance: { openBalance: 125, openInvoiceCount: 1, invoiceCount: 1 } };
          return null;
        });
        return mockJsonResponse({ token: 'portal-token', name: 'Blue Fin', email: 'buyer@example.com' });
      }
      return mockJsonResponse({}, false, 404);
    });

    render(<CustomerPortalPage />);

    fireEvent.change(screen.getByPlaceholderText('you@restaurant.com'), { target: { value: 'buyer@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email Verification Code' }));

    expect(await screen.findByText('Enter verification code')).toBeInTheDocument();
    expect(screen.getByText(/b\*\*\*@example.com/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Enter the 6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and Sign In' }));

    expect(await screen.findByText('NodeRoute Customer Portal')).toBeInTheDocument();
    expect(await screen.findByText('ORD-9')).toBeInTheDocument();
    expect(setPortalTokenMock).toHaveBeenCalledWith('portal-token');
  });

  it('renders invoice display and order history for an authenticated customer', async () => {
    getPortalTokenMock.mockReturnValue('portal-token');
    fetchWithPortalAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/portal/me') return { email: 'buyer@example.com', name: 'Harbor Cafe' };
      if (url === '/api/portal/orders') return [{ id: 'o1', order_number: 'ORD-101', customer_name: 'Harbor Cafe', customer_address: '1 Dock St', status: 'pending', created_at: '2026-04-01T00:00:00Z', items: [{ description: 'Salmon' }] }];
      if (url === '/api/portal/invoices') return [{ id: 'i1', invoice_number: 'INV-101', total: 250, status: 'sent', driver_name: 'Alex', created_at: '2026-04-02T00:00:00Z' }];
      if (url === '/api/portal/contact') return { email: 'buyer@example.com', name: 'Harbor Cafe' };
      if (url === '/api/portal/inventory') return [];
      if (url === '/api/portal/payments/config') return { enabled: true, provider: 'stripe', balance: { openBalance: 250, openInvoiceCount: 1, invoiceCount: 1 }, payment_methods: [] };
      if (url === '/api/portal/payments/profile') return { payment_methods: [], autopay: { enabled: false }, balance: { openBalance: 250, openInvoiceCount: 1, invoiceCount: 1 } };
      return null;
    });

    render(<CustomerPortalPage />);

    expect(await screen.findByText('ORD-101')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    expect(await screen.findByText('INV-101')).toBeInTheDocument();
    expect(screen.getAllByText('$250.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /pdf/i })).toBeInTheDocument();
  });

  it('shows empty states when the customer has no order or invoice history', async () => {
    getPortalTokenMock.mockReturnValue('portal-token');
    fetchWithPortalAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/portal/me') return { email: 'buyer@example.com', name: 'Quiet Account' };
      if (url === '/api/portal/orders') return [];
      if (url === '/api/portal/invoices') return [];
      if (url === '/api/portal/contact') return { email: 'buyer@example.com', name: 'Quiet Account' };
      if (url === '/api/portal/inventory') return [];
      if (url === '/api/portal/payments/config') return { enabled: false, balance: { openBalance: 0, openInvoiceCount: 0, invoiceCount: 0 }, payment_methods: [] };
      if (url === '/api/portal/payments/profile') return { payment_methods: [], autopay: { enabled: false }, balance: { openBalance: 0, openInvoiceCount: 0, invoiceCount: 0 } };
      return null;
    });

    render(<CustomerPortalPage />);

    expect(await screen.findByText('No orders available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    expect(await screen.findByText('No invoices are available for this customer account yet.')).toBeInTheDocument();
  });

  it('surfaces failed portal API calls', async () => {
    getPortalTokenMock.mockReturnValue('portal-token');
    fetchWithPortalAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/portal/me') throw new Error('Portal backend unavailable');
      return [];
    });

    render(<CustomerPortalPage />);

    expect(await screen.findByText('Portal backend unavailable')).toBeInTheDocument();
  });
});
