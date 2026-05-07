import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchasingPage } from './PurchasingPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

const baseOrders = [
  {
    id: 'po-1',
    po_number: 'PO-100',
    vendor: 'Blue Ocean Seafood',
    total_cost: 245.5,
    confirmed_by: 'Alex',
    created_at: '2026-04-10T00:00:00Z',
    items: [{ id: 'line-1' }, { id: 'line-2' }],
  },
  {
    id: 'po-2',
    po_number: 'PO-200',
    vendor: 'Harbor Supply',
    total_cost: 100,
    confirmed_by: 'Jamie',
    created_at: '2026-04-11T00:00:00Z',
    items: [{ id: 'line-3' }],
  },
];

const baseProducts = [
  {
    item_number: 'SAL-1',
    description: 'Fresh Salmon',
    unit: 'lb',
    cost: 12.5,
    category: 'Seafood',
  },
  {
    item_number: 'BOX-1',
    description: 'Shipping Box',
    unit: 'ea',
    cost: 2,
    category: 'Packaging',
  },
];

function mockPurchasingApi({
  orders = baseOrders,
  products = baseProducts,
}: {
  orders?: unknown[];
  products?: unknown[];
} = {}) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/purchase-orders')) return orders;
    if (url === '/api/inventory') return products;
    return [];
  });
}

function renderPurchasingPage(initialEntry = '/purchasing') {
  return renderWithQueryClient(<PurchasingPage />, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>,
  });
}

function confirmPoCard() {
  const heading = screen.getByRole('heading', { name: 'Confirm Purchase Order' });
  const card = heading.closest('div.rounded-lg') as HTMLElement | null;
  if (!card) throw new Error('Expected confirm purchase order card');
  return card;
}

describe('PurchasingPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    mockPurchasingApi();
  });

  it('renders purchasing summaries, respects vendor query filtering, and filters the history table', async () => {
    renderPurchasingPage('/purchasing?vendor=Blue%20Ocean%20Seafood');

    expect(await screen.findByText('PO-100')).toBeInTheDocument();
    expect(await screen.findByText('Filtered by vendor from Vendors page:')).toBeInTheDocument();
    expect(screen.getAllByText('Blue Ocean Seafood').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$345.50').length).toBeGreaterThan(0);
    expect(screen.queryByText('PO-200')).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Blue Ocean Seafood'), { target: { value: 'Harbor Supply' } });

    await waitFor(() => {
      expect(screen.getByText('PO-200')).toBeInTheDocument();
      expect(screen.queryByText('PO-100')).not.toBeInTheDocument();
    });
  });

  it('validates PO confirmation and submits a successful purchase order', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ lots_created: 1 });

    renderPurchasingPage();

    expect(await screen.findByText('PO-100')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm PO' }));
    expect(await screen.findByText('Add at least one line with description and quantity.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Blue Ocean Seafood'), { target: { value: 'Blue Ocean Seafood' } });
    fireEvent.change(screen.getByPlaceholderText('PO-2026-044'), { target: { value: 'PO-300' } });
    fireEvent.change(screen.getByPlaceholderText('Dock B receiving'), { target: { value: 'Cold storage intake' } });
    const lineRow = within(confirmPoCard()).getAllByRole('row')[1];
    fireEvent.change(within(lineRow).getByPlaceholderText('Atlantic Salmon'), { target: { value: 'Fresh Salmon' } });
    fireEvent.change(within(lineRow).getByPlaceholderText('SAL-01'), { target: { value: 'SAL-1' } });

    const spinbuttons = within(lineRow).getAllByRole('spinbutton');
    fireEvent.change(spinbuttons[0], { target: { value: '4' } });
    fireEvent.change(spinbuttons[1], { target: { value: '12.5' } });

    fireEvent.change(within(lineRow).getByDisplayValue('lb'), { target: { value: 'lb' } });
    fireEvent.change(within(lineRow).getByDisplayValue('Other'), { target: { value: 'Seafood' } });
    fireEvent.change(within(lineRow).getByPlaceholderText('e.g. SAL-2026-001'), { target: { value: 'SAL-LOT-1' } });
    const expirationInput = lineRow.querySelector('input[type="date"]') as HTMLInputElement | null;
    if (!expirationInput) throw new Error('Expected expiration date input');
    fireEvent.change(expirationInput, { target: { value: '2026-05-10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm PO' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/purchase-orders/confirm', 'POST', {
        vendor: 'Blue Ocean Seafood',
        po_number: 'PO-300',
        notes: 'Cold storage intake',
        total_cost: 50,
        items: [
          {
            description: 'Fresh Salmon',
            item_number: 'SAL-1',
            quantity: 4,
            unit_price: 12.5,
            unit: 'lb',
            category: 'Seafood',
            lot_number: 'SAL-LOT-1',
            expiration_date: '2026-05-10',
            total: 50,
          },
        ],
      });
    });
    expect(await screen.findByText('Purchase order confirmed and inventory updated. 1 lot record(s) created.')).toBeInTheDocument();
  });

  it('surfaces purchase order loading failures', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/purchase-orders')) throw new Error('Purchasing API unavailable');
      if (url === '/api/inventory') return baseProducts;
      return [];
    });

    renderPurchasingPage();

    expect(await screen.findByText('Purchasing API unavailable')).toBeInTheDocument();
  });
});
