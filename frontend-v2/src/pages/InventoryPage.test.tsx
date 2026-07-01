import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { InventoryPage } from './InventoryPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, getUserRoleMock, hasRoleMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  getUserRoleMock: vi.fn(),
  hasRoleMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  getUserRole: getUserRoleMock,
  hasRole: hasRoleMock,
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
const activeLots = [
  {
    id: 'lot-1',
    lot_number: 'SAL-LOT-1',
    product_id: 'SAL-1',
    received_date: '2026-04-01',
    expiration_date: '2026-04-20',
  },
  {
    id: 'lot-2',
    lot_number: 'TUN-LOT-9',
    product_id: 'TUN-1',
    received_date: '2026-04-03',
    expiration_date: '2026-04-18',
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
    if (url === '/api/company-config/features') {
      return {
        business_types: ['seafood'],
        enabled_units: ['lb', 'each'],
        feat_catch_weight: true,
        feat_fsma_lot_tracking: true,
        feat_cold_chain_notes: false,
        feat_alcohol_compliance: false,
        feat_deposit_tracking: false,
        feat_case_to_each: false,
        catalog_template: 'seafood',
        onboarding_completed: true,
      };
    }
    if (url === '/api/settings/company') {
      return {
        businessName: 'Blue Harbor Seafood Co.',
      };
    }
    if (url === '/api/lots?active_only=true') return activeLots;
    if (url.startsWith('/api/inventory/ledger?')) return ledgerResponse;
    if (url === '/api/reporting/recent-sold-items?days=30') {
      return {
        item_count: 1,
        items: [{ key: 'box-1', item_number: 'BOX-1', label: 'Shipping Box', invoice_count: 1, qty: 4 }],
      };
    }
    if (url === '/api/reporting/recent-sold-items?days=60') {
      return {
        item_count: 2,
        items: [
          { key: 'sal-1', item_number: 'SAL-1', label: 'Fresh Salmon', invoice_count: 2, qty: 10 },
          { key: 'box-1', item_number: 'BOX-1', label: 'Shipping Box', invoice_count: 1, qty: 4 },
        ],
      };
    }
    if (url === '/api/reporting/recent-sold-items?days=90') {
      return {
        item_count: 3,
        items: [
          { key: 'sal-1', item_number: 'SAL-1', label: 'Fresh Salmon', invoice_count: 2, qty: 10 },
          { key: 'tun-1', item_number: 'TUN-1', label: 'Tuna Steaks', invoice_count: 1, qty: 2 },
          { key: 'box-1', item_number: 'BOX-1', label: 'Shipping Box', invoice_count: 1, qty: 4 },
        ],
      };
    }
    return null;
  });
}

function renderInventoryPage() {
  return renderWithQueryClient(<MemoryRouter><InventoryPage /></MemoryRouter>);
}

describe('InventoryPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    getUserRoleMock.mockReset();
    hasRoleMock.mockReset();
    sendWithAuthMock.mockReset();
    getUserRoleMock.mockReturnValue('admin');
    hasRoleMock.mockReturnValue(true);
    mockInventoryApi();
  });

  it('renders inventory summaries and filters the inventory overview table', async () => {
    renderInventoryPage();

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('Dock delivery')).toBeInTheDocument();
    expect(screen.getByText('SAL-LOT-1')).toBeInTheDocument();
    expect(screen.getByText('TUN-LOT-9')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search item/category'), { target: { value: 'pack' } });

    await waitFor(() => {
      expect(screen.getByText('Shipping Box')).toBeInTheDocument();
      expect(screen.queryByText('Fresh Salmon')).not.toBeInTheDocument();
    });
  });

  it('paginates the inventory overview after filtering', async () => {
    const manyItems = Array.from({ length: 26 }, (_, index) => ({
      id: `bulk-${index + 1}`,
      item_number: `BULK-${String(index + 1).padStart(2, '0')}`,
      description: `Bulk Item ${index + 1}`,
      category: 'Bulk',
      on_hand_qty: 10 + index,
      cost: 1,
      unit: 'each',
      is_ftl_product: false,
      is_catch_weight: false,
    }));
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/inventory') return manyItems;
      if (url === '/api/company-config/features') return { feat_catch_weight: false, feat_fsma_lot_tracking: false, onboarding_completed: true };
      if (url === '/api/settings/company') return { businessName: 'Blue Harbor Seafood Co.' };
      if (url === '/api/lots?active_only=true') return [];
      if (url.startsWith('/api/inventory/ledger?')) return ledgerResponse;
      return null;
    });

    renderInventoryPage();

    expect(await screen.findByText('Bulk Item 1')).toBeInTheDocument();
    expect(screen.queryByText('Bulk Item 26')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Bulk Item 26')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search item/category'), { target: { value: 'Bulk Item 26' } });
    expect(await screen.findByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Bulk Item 26')).toBeInTheDocument();
  });

  it('validates and submits a restock action, then refreshes inventory data', async () => {
    sendWithAuthMock.mockResolvedValueOnce({});

    renderInventoryPage();

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
    expect(await screen.findByText('Restocked SAL-1 - Fresh Salmon by 25.')).toBeInTheDocument();
  });

  it('validates transfer input and supports successful transfer and spoilage actions', async () => {
    sendWithAuthMock
      .mockResolvedValueOnce({ transfer_ref: 'TR-100' })
      .mockResolvedValueOnce({});

    renderInventoryPage();

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();

    const tasksCard = screen.getByRole('heading', { name: 'Inventory Tasks' }).closest('div.rounded-lg') as HTMLElement | null;
    if (!tasksCard) throw new Error('Expected inventory tasks card');

    fireEvent.click(within(tasksCard).getByRole('tab', { name: 'Transfer' }));

    fireEvent.change(within(tasksCard).getByLabelText('From Item'), { target: { value: '1' } });
    fireEvent.change(within(tasksCard).getByLabelText('To Item'), { target: { value: '1' } });
    fireEvent.change(within(tasksCard).getByLabelText('Quantity'), { target: { value: '4' } });
    fireEvent.click(within(tasksCard).getByRole('button', { name: 'Transfer Stock' }));

    expect(await screen.findByText('Source and destination must be different.')).toBeInTheDocument();

    fireEvent.change(within(tasksCard).getByLabelText('To Item'), { target: { value: '2' } });
    fireEvent.change(within(tasksCard).getByLabelText('Notes'), { target: { value: 'Move to backup stock' } });
    fireEvent.click(within(tasksCard).getByRole('button', { name: 'Transfer Stock' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/inventory/transfer', 'POST', {
        from_item_number: 'SAL-1',
        to_item_number: 'TUN-1',
        qty: 4,
        notes: 'Move to backup stock',
      });
    });
    expect(await screen.findByText('Transfer completed for SAL-1 - Fresh Salmon -> TUN-1 - Tuna Steaks (TR-100).')).toBeInTheDocument();

    fireEvent.click(within(tasksCard).getByRole('tab', { name: 'Spoilage' }));

    fireEvent.change(within(tasksCard).getByLabelText('Item'), { target: { value: '2' } });
    fireEvent.change(within(tasksCard).getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.change(within(tasksCard).getByLabelText('Reason'), { target: { value: 'Temperature excursion' } });
    fireEvent.change(within(tasksCard).getByLabelText('Notes'), { target: { value: 'Walk-in issue' } });
    fireEvent.click(within(tasksCard).getByRole('button', { name: 'Post Spoilage' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/inventory/TUN-1/spoilage', 'POST', {
        qty: 2,
        reason: 'Temperature excursion',
        notes: 'Walk-in issue',
      });
    });
    expect(await screen.findByText('Spoilage recorded for TUN-1 - Tuna Steaks.')).toBeInTheDocument();
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

    renderInventoryPage();

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

  it('builds category-based inventory count reports for printing', async () => {
    const printMock = vi.fn();
    const focusMock = vi.fn();
    const writeMock = vi.fn();
    const closeMock = vi.fn();
    const openMock = vi.spyOn(window, 'open').mockReturnValue({
      document: {
        write: writeMock,
        close: closeMock,
      },
      focus: focusMock,
      print: printMock,
    } as unknown as Window);

    renderInventoryPage();

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Class Name Scope'), { target: { value: 'Packaging' } });
    fireEvent.click(screen.getByLabelText('Include zero-stock items'));
    fireEvent.click(screen.getByRole('button', { name: 'Print Count Sheet' }));

    expect(openMock).toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalled();
    const printedHtml = String(writeMock.mock.calls[0]?.[0] || '');
    expect(printedHtml).toContain('<title>Blue Harbor Seafood Co. Inventory Count Sheet</title>');
    expect(printedHtml).toContain('Packaging');
    expect(printedHtml).toContain('Shipping Box');
    expect(printedHtml).not.toContain('Fresh Salmon');
    expect(printedHtml).toContain('Physical Count');
    expect(printedHtml).toContain('class="print-footer">Blue Harbor Seafood Co.</div>');
    expect(focusMock).toHaveBeenCalled();
    expect(printMock).toHaveBeenCalled();

    openMock.mockRestore();
  });

  it('excludes items not sold in the selected recent-sales window from count sheets', async () => {
    const printMock = vi.fn();
    const focusMock = vi.fn();
    const writeMock = vi.fn();
    const closeMock = vi.fn();
    const openMock = vi.spyOn(window, 'open').mockReturnValue({
      document: {
        write: writeMock,
        close: closeMock,
      },
      focus: focusMock,
      print: printMock,
    } as unknown as Window);

    renderInventoryPage();

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Recent Sales Filter'), { target: { value: '30' } });

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/reporting/recent-sold-items?days=30');
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Print Count Sheet' })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Print Count Sheet' }));

    const printedHtml = String(writeMock.mock.calls[0]?.[0] || '');
    expect(printedHtml).toContain('Shipping Box');
    expect(printedHtml).not.toContain('Fresh Salmon');
    expect(printedHtml).not.toContain('Tuna Steaks');

    openMock.mockRestore();
  });

  it('explains why count sheets are empty when filters exclude every row', async () => {
    renderInventoryPage();

    expect(await screen.findByText('Fresh Salmon')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Class Name Scope'), { target: { value: 'Seafood' } });
    fireEvent.change(screen.getByLabelText('Recent Sales Filter'), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText('Include zero-stock items'));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/reporting/recent-sold-items?days=30');
    });

    expect(await screen.findByText('No count-sheet rows match the current filters.')).toBeInTheDocument();
    expect(screen.getByText(/class name scope is limited to Seafood/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print Count Sheet' })).toBeDisabled();
  });
});
