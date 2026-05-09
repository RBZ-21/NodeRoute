import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchasingPage } from './PurchasingPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

const openMock = vi.fn();
const fetchMock = vi.fn();

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

const baseVendorPurchaseOrders = [
  {
    id: 'ops-po-1',
    po_number: 'PO-OPS-100',
    vendor: 'Blue Ocean Seafood',
    status: 'open',
    total_ordered_qty: 20,
    total_received_qty: 4,
    total_backordered_qty: 16,
    created_at: '2026-04-12T00:00:00Z',
    receipt_rules: {
      over_receipt_policy: 'cap',
      backorder_policy: 'open',
    },
    lines: [
      {
        line_no: 1,
        item_number: 'SAL-1',
        product_name: 'Fresh Salmon',
        unit: 'lb',
        ordered_qty: 10,
        received_qty: 4,
        backordered_qty: 6,
        unit_cost: 12.5,
      },
      {
        line_no: 2,
        item_number: 'BOX-1',
        product_name: 'Shipping Box',
        unit: 'each',
        ordered_qty: 10,
        received_qty: 0,
        backordered_qty: 10,
        unit_cost: 2,
      },
    ],
    receipts: [],
  },
];

const vendorPurchaseOrdersWithDiscrepancies = [
  {
    ...baseVendorPurchaseOrders[0],
    first_received_at: '2026-04-13T13:00:00Z',
    first_receipt_lead_time_days: 1.04,
    first_receipt_lead_time_hours: 25,
    lead_time_history: {
      vendor: 'Blue Ocean Seafood',
      receipt_count: 1,
      average_days: 1.04,
      median_days: 1.04,
      minimum_days: 1.04,
      maximum_days: 1.04,
      latest_days: 1.04,
    },
    receipts: [
      {
        id: 'rcv-2',
        received_at: '2026-04-13T13:00:00Z',
        received_by: 'Jamie',
        notes: 'Vendor shorted line 2',
        variance_audit: {
          total_accepted_qty: 10,
          total_rejected_qty: 0,
          total_backordered_qty_after_receipt: 2,
        },
        lines: [
          {
            line_no: 2,
            item_number: 'BOX-1',
            product_name: 'Shipping Box',
            variance_type: 'short_receipt',
            quantity_variance_qty: -2,
            over_receipt_qty: 0,
          },
        ],
      },
    ],
  },
];

function mockPurchasingApi({
  orders = baseOrders,
  products = baseProducts,
  vendorPurchaseOrders = baseVendorPurchaseOrders,
}: {
  orders?: unknown[];
  products?: unknown[];
  vendorPurchaseOrders?: unknown[];
} = {}) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/purchase-orders')) return orders;
    if (url === '/api/inventory') return products;
    if (url === '/api/ops/vendor-purchase-orders') return vendorPurchaseOrders;
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
    openMock.mockReset();
    fetchMock.mockReset();
    openMock.mockReturnValue({
      document: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
    });
    vi.stubGlobal('open', openMock);
    vi.stubGlobal('fetch', fetchMock);
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
    sendWithAuthMock.mockResolvedValueOnce({ lots_created: 1, purchase_order: { id: 'po-300', po_number: 'PO-300' } });

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
    expect(await screen.findByText('Purchase order confirmed and inventory updated. PO # PO-300. 1 lot record(s) created.')).toBeInTheDocument();
  });

  it('requires a lot number before confirming mollusk items', async () => {
    renderPurchasingPage();

    expect(await screen.findByText('PO-100')).toBeInTheDocument();

    const lineRow = within(confirmPoCard()).getAllByRole('row')[1];
    fireEvent.change(within(lineRow).getByPlaceholderText('Atlantic Salmon'), { target: { value: 'Fresh Clams' } });
    fireEvent.change(within(lineRow).getByDisplayValue('Other'), { target: { value: 'Mollusks' } });
    fireEvent.change(within(lineRow).getAllByRole('spinbutton')[0], { target: { value: '5' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm PO' }));

    expect(await screen.findByText('Lot number is required before confirming mollusk item "Fresh Clams".')).toBeInTheDocument();
    expect(sendWithAuthMock).not.toHaveBeenCalled();
  });

  it('surfaces purchase order loading failures', async () => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/purchase-orders')) throw new Error('Purchasing API unavailable');
      if (url === '/api/inventory') return baseProducts;
      if (url === '/api/ops/vendor-purchase-orders') return baseVendorPurchaseOrders;
      return [];
    });

    renderPurchasingPage();

    expect(await screen.findByText('Purchasing API unavailable')).toBeInTheDocument();
  });

  it('lets users open an open vendor PO and post a receipt against it', async () => {
    sendWithAuthMock.mockImplementation(async (url: string, method: string, body: unknown) => {
      if (url === '/api/ops/vendor-purchase-orders/ops-po-1/receive' && method === 'POST') {
        expect(body).toEqual({
          lines: [
            {
              line_no: 1,
              qty_received: 6,
              unit_cost: 12.5,
              item_number: 'SAL-1',
              product_name: 'Fresh Salmon',
            },
            {
              line_no: 2,
              qty_received: 8,
              unit_cost: 2,
              item_number: 'BOX-1',
              product_name: 'Shipping Box',
            },
          ],
          notes: 'Pallet 3 shorted 2 boxes',
          receiptRules: {
            over_receipt_policy: 'cap',
            backorder_policy: 'open',
          },
        });

        return {
          ...baseVendorPurchaseOrders[0],
          status: 'backordered',
          total_received_qty: 18,
          total_backordered_qty: 2,
          receipts: [
            {
              id: 'rcv-1',
              received_at: '2026-04-12T13:00:00Z',
              received_by: 'Jamie',
              notes: 'Pallet 3 shorted 2 boxes',
              variance_audit: {
                total_accepted_qty: 14,
                total_rejected_qty: 0,
                total_backordered_qty_after_receipt: 2,
              },
              lines: [
                {
                  line_no: 1,
                  product_name: 'Fresh Salmon',
                  variance_type: 'exact_receipt',
                  quantity_variance_qty: 0,
                  over_receipt_qty: 0,
                },
                {
                  line_no: 2,
                  product_name: 'Shipping Box',
                  variance_type: 'short_receipt',
                  quantity_variance_qty: -2,
                  over_receipt_qty: 0,
                },
              ],
            },
          ],
        };
      }

      return { lots_created: 0 };
    });

    renderPurchasingPage();

    expect(await screen.findByText('PO-OPS-100')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Receive Items' }));
    expect(await screen.findByText('Receiving PO-OPS-100')).toBeInTheDocument();

    const receiptNotes = screen.getByPlaceholderText('Driver shorted 2 cases on pallet 3');
    fireEvent.change(receiptNotes, { target: { value: 'Pallet 3 shorted 2 boxes' } });

    const receiveNowInputs = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(receiveNowInputs[0], { target: { value: '6' } });
    fireEvent.change(receiveNowInputs[1], { target: { value: '8' } });

    fireEvent.click(screen.getByRole('button', { name: 'Post Receipt to Inventory' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith(
        '/api/ops/vendor-purchase-orders/ops-po-1/receive',
        'POST',
        expect.any(Object),
      );
    });

    expect(await screen.findByText('Receipt posted for PO-OPS-100. Accepted 14.00 unit(s), rejected 0.00, backordered 2.00.')).toBeInTheDocument();
    expect(screen.getAllByText('Shipping Box: short receipt (-2.00)').length).toBeGreaterThan(0);
  });

  it('shows discrepancy log activity when receipts have variances', async () => {
    mockPurchasingApi({ vendorPurchaseOrders: vendorPurchaseOrdersWithDiscrepancies });

    renderPurchasingPage();

    expect(await screen.findByText('Discrepancy Log')).toBeInTheDocument();
    expect(screen.getByText('Receipts w/ variance:')).toBeInTheDocument();
    expect(screen.getByText('Recent Discrepancy Activity')).toBeInTheDocument();
    const discrepancyMatches = await screen.findAllByText((_, element) => {
      const text = element?.textContent || '';
      return text.includes('Shipping Box:') && text.includes('short receipt') && text.includes('(-2.00)');
    });
    expect(discrepancyMatches.length).toBeGreaterThan(0);
    expect(screen.getAllByText('PO-OPS-100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.04 d').length).toBeGreaterThan(0);
  });

  it('applies scan review metadata for item type and lot suggestions', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        vendor: 'Blue Ocean Seafood',
        po_number: 'PO-SCAN-9',
        date: '2026-05-08',
        total_cost: 62.5,
        items: [
          {
            description: 'Fresh Salmon',
            category: 'Seafood',
            quantity: 5,
            unit: 'lb',
            unit_price: 12.5,
            total: 62.5,
            item_type: 'weighted',
            lot_number: 'SAL-LOT-9',
            lot_number_confidence: 'high',
          },
        ],
      }),
    });

    renderPurchasingPage();

    expect(await screen.findByText('PO-100')).toBeInTheDocument();

    const fileInputs = document.querySelectorAll('input[type="file"]');
    const uploadInput = fileInputs[0] as HTMLInputElement | undefined;
    if (!uploadInput) throw new Error('Expected upload input');
    const file = new File(['scan'], 'po-scan.jpg', { type: 'image/jpeg' });
    fireEvent.change(uploadInput, { target: { files: [file] } });

    expect(await screen.findByText((text) => text.includes('Weighted items detected:'))).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('Lot numbers detected:'))).toBeInTheDocument();
    expect(screen.getByDisplayValue('SAL-LOT-9')).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('Scan detected lot'))).toBeInTheDocument();
    expect(screen.getByText(/^Weighted$/)).toBeInTheDocument();
  });

  it('opens the generated purchase-order PDF for historical purchase orders', async () => {
    renderPurchasingPage();

    expect(await screen.findByText('PO-100')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open PDF' })[0]);

    expect(openMock).toHaveBeenCalledWith('/api/purchase-orders/po-1/pdf', '_blank', 'noopener,noreferrer');
  });
});
