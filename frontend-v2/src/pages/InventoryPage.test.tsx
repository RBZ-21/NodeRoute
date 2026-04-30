import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryPage } from './InventoryPage';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

const inventoryItems = [
  {
    id: '1',
    item_number: 'SAL-1',
    description: 'Fresh Salmon',
    category: 'Seafood',
    on_hand_qty: 8,
    cost: 10,
    unit: 'lb',
    is_ftl_product: false,
    is_catch_weight: false,
  },
  {
    id: '2',
    item_number: 'TUN-1',
    description: 'Tuna Steaks',
    category: 'Seafood',
    on_hand_qty: 0,
    cost: 12,
    unit: 'lb',
    is_ftl_product: true,
    is_catch_weight: false,
  },
  {
    id: '3',
    item_number: 'BOX-1',
    description: 'Shipping Box',
    category: 'Packaging',
    on_hand_qty: 20,
    cost: 2,
    unit: 'ea',
    is_ftl_product: false,
    is_catch_weight: false,
  },
];

const ledgerResponse = {
  summary: {
    count: 2,
    total_delta: 5,
    inbound_qty: 10,
    outbound_qty: 5,
  },
  entries: [
    {
      item_number: 'SAL-1',
      change_qty: 10,
      new_qty: 18,
      change_type: 'restock',
      notes: 'Dock delivery',
      created_by: 'Alex',
      created_at: '2026-04-01T00:00:00Z',
    },
  ],
};

function mockInventoryApi() {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/inventory') return inventoryItems;
    if (url.startsWith('/api/inventory/ledger?')) return ledgerResponse;
    return null;
  });
}

describe('InventoryPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    mockInventoryApi();
  });

  it('renders inventory summaries and filters the inventory overview table', async () => {
    render(<InventoryPage />);

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('Dock delivery')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search item/category'), { target: { value: 'pack' } });

    await waitFor(() => {
      expect(screen.getByText('Shipping Box')).toBeInTheDocument();
      expect(screen.queryByText('Fresh Salmon')).not.toBeInTheDocument();
    });
  });

  it('validates and submits a restock action, then refreshes inventory data', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    render(<InventoryPage />);

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restock Item' }));
    expect(await screen.findByText('Restock quantity must be greater than 0.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Restock Qty'), { target: { value: '25' } });
    fireEvent.change(screen.getAllByLabelText('Notes')[0], { target: { value: 'Dock delivery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restock Item' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/inventory/SAL-1/restock', 'POST', {
        qty: 25,
        notes: 'Dock delivery',
      });
    });
    expect(await screen.findByText('Restocked SAL-1 by 25.')).toBeInTheDocument();
  });

  it('validates transfer input and supports successful transfer and spoilage actions', async () => {
    sendWithAuthMock
      .mockResolvedValueOnce({ transfer_ref: 'TR-100' })
      .mockResolvedValueOnce({});

    render(<InventoryPage />);

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();

    const transferCard = screen.getByRole('heading', { name: 'Transfer Inventory' }).closest('div.rounded-lg') as HTMLElement | null;
    if (!transferCard) throw new Error('Expected transfer card');

    fireEvent.change(within(transferCard).getByLabelText('From Item'), { target: { value: 'SAL-1' } });
    fireEvent.change(within(transferCard).getByLabelText('To Item'), { target: { value: 'SAL-1' } });
    fireEvent.change(within(transferCard).getByLabelText('Quantity'), { target: { value: '4' } });
    fireEvent.click(within(transferCard).getByRole('button', { name: 'Transfer Stock' }));

    expect(await screen.findByText('Transfer source and destination must be different.')).toBeInTheDocument();

    fireEvent.change(within(transferCard).getByLabelText('To Item'), { target: { value: 'TUN-1' } });
    fireEvent.change(within(transferCard).getByLabelText('Notes'), { target: { value: 'Move to backup stock' } });
    fireEvent.click(within(transferCard).getByRole('button', { name: 'Transfer Stock' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/inventory/transfer', 'POST', {
        from_item_number: 'SAL-1',
        to_item_number: 'TUN-1',
        qty: 4,
        notes: 'Move to backup stock',
      });
    });
    expect(await screen.findByText('Transfer completed (TR-100).')).toBeInTheDocument();

    const spoilageCard = screen.getByRole('heading', { name: 'Record Spoilage' }).closest('div.rounded-lg') as HTMLElement | null;
    if (!spoilageCard) throw new Error('Expected spoilage card');

    fireEvent.change(within(spoilageCard).getByLabelText('Item'), { target: { value: 'TUN-1' } });
    fireEvent.change(within(spoilageCard).getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.change(within(spoilageCard).getByLabelText('Reason'), { target: { value: 'Temperature excursion' } });
    fireEvent.change(within(spoilageCard).getByLabelText('Notes'), { target: { value: 'Walk-in issue' } });
    fireEvent.click(within(spoilageCard).getByRole('button', { name: 'Post Spoilage' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/inventory/TUN-1/spoilage', 'POST', {
        qty: 2,
        reason: 'Temperature excursion',
        notes: 'Walk-in issue',
      });
    });
    expect(await screen.findByText('Spoilage recorded for TUN-1.')).toBeInTheDocument();
  });

  it('applies ledger filters and updates inline FTL and catch-weight settings', async () => {
    sendWithAuthMock.mockImplementation(async (url: string, method: string, body: Record<string, unknown>) => {
      if (url === '/api/lots/products/SAL-1/ftl') {
        return { item_number: 'SAL-1', is_ftl_product: true };
      }
      if (url === '/api/inventory/SAL-1' && method === 'PATCH' && 'is_catch_weight' in body) {
        return { item_number: 'SAL-1', is_catch_weight: true };
      }
      if (url === '/api/inventory/SAL-1' && method === 'PATCH' && 'default_price_per_lb' in body) {
        return { item_number: 'SAL-1', default_price_per_lb: 14.5 };
      }
      return null;
    });

    render(<InventoryPage />);

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();

    const ledgerCard = screen.getByRole('heading', { name: 'Inventory Ledger' }).closest('div.rounded-lg') as HTMLElement | null;
    if (!ledgerCard) throw new Error('Expected ledger card');

    fireEvent.change(within(ledgerCard).getByLabelText('Item Filter'), { target: { value: 'SAL-1' } });
    fireEvent.change(within(ledgerCard).getByLabelText('Change Type'), { target: { value: 'restock' } });
    fireEvent.change(within(ledgerCard).getByLabelText('Limit'), { target: { value: '999' } });
    fireEvent.click(within(ledgerCard).getByRole('button', { name: 'Apply Ledger Filters' }));

    await waitFor(() => {
      expect(
        fetchWithAuthMock.mock.calls.some(([url]) => url === '/api/inventory/ledger?item_number=SAL-1&change_type=restock&limit=500')
      ).toBe(true);
    });

    const overviewCard = screen.getByRole('heading', { name: 'Inventory Overview' }).closest('div.rounded-lg') as HTMLElement | null;
    if (!overviewCard) throw new Error('Expected inventory overview card');

    const salmonRow = within(overviewCard).getAllByText('SAL-1')[0].closest('tr') as HTMLElement | null;
    if (!salmonRow) throw new Error('Expected salmon row');

    fireEvent.click(within(salmonRow).getByTitle(/Not on FDA Traceability List/i));
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/lots/products/SAL-1/ftl', 'PATCH', {
        is_ftl_product: true,
      });
    });

    fireEvent.click(within(salmonRow).getByTitle(/Not catch weight/i));
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/inventory/SAL-1', 'PATCH', {
        is_catch_weight: true,
      });
    });

    const updatedSalmonRow = within(overviewCard).getAllByText('SAL-1')[0].closest('tr') as HTMLElement | null;
    if (!updatedSalmonRow) throw new Error('Expected updated salmon row');

    fireEvent.click(within(updatedSalmonRow).getByRole('button', { name: 'Set' }));
    fireEvent.change(within(updatedSalmonRow).getByRole('spinbutton'), { target: { value: '14.5' } });
    fireEvent.click(within(updatedSalmonRow).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/inventory/SAL-1', 'PATCH', {
        default_price_per_lb: 14.5,
      });
    });
    expect(await screen.findByRole('button', { name: '$14.5000' })).toBeInTheDocument();
  });
});
