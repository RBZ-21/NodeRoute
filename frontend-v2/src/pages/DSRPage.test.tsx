import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DSRPage } from './DSRPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  fetchListWithAuth: (url: string) =>
    fetchWithAuthMock(url).then((d: unknown) => {
      if (!Array.isArray(d)) throw new Error(`Expected a list response from ${url}`);
      return d;
    }),
}));

function renderDsrPage() {
  return renderWithQueryClient(<DSRPage />);
}

describe('DSRPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/reporting/rollups?')) {
        return {
          overview: {
            order_count: 5,
            invoice_count: 4,
            revenue: 1240,
            estimated_cost: 780,
            margin: 460,
            margin_pct: 37.1,
          },
          customer: [
            { label: 'Blue Crab Cafe', revenue: 420, margin: 140, margin_pct: 33.3, order_count: 3, invoice_count: 2, qty: 16, estimated_cost: 280 },
          ],
          driver: [],
          route: [],
          sku: [],
        };
      }
      if (String(url).startsWith('/api/reporting/sales-summary?')) {
        return {
          overview: {
            total_sales: 1240,
            delivery_sales: 910,
            pickup_sales: 330,
            unknown_sales: 0,
            invoice_count: 4,
            order_count: 5,
            average_invoice: 310,
            item_count: 3,
          },
        };
      }
      if (String(url).startsWith('/api/orders?')) {
        return [
          { status: 'pending', total: 400 },
          { status: 'pending', total: 240 },
          { status: 'invoiced', total: 600 },
        ];
      }
      if (String(url).startsWith('/api/reporting/daily-ops?')) {
        return {
          overview: {
            fill_rate_pct: 94.5,
            requested_qty: 110,
            accepted_qty: 103.95,
            short_qty: 6.05,
            over_receipt_qty: 0,
            receipt_count: 3,
            vendor_count: 2,
            short_receipt_line_count: 2,
            short_receipt_po_count: 1,
            category_count: 2,
            inventory_sku_count: 6,
            low_stock_sku_count: 2,
            top_customer_count: 1,
          },
          top_customers: [
            { label: 'Blue Crab Cafe', revenue: 420, margin: 140, margin_pct: 33.3, order_count: 3, invoice_count: 2, qty: 16, estimated_cost: 280 },
          ],
          on_hand_by_category: [
            { category: 'Seafood', sku_count: 4, total_on_hand_qty: 88, estimated_stock_value: 1560, low_stock_sku_count: 1 },
            { category: 'Packaging', sku_count: 2, total_on_hand_qty: 24, estimated_stock_value: 180, low_stock_sku_count: 1 },
          ],
          vendor_fill: [
            { vendor: 'North Sea', po_count: 1, receipt_count: 2, line_count: 4, requested_qty: 70, accepted_qty: 66.5, short_qty: 3.5, over_receipt_qty: 0, short_receipt_line_count: 1, fill_rate_pct: 95 },
          ],
          short_ship_lines: [
            { po_number: 'PO-1001', vendor: 'North Sea', product_name: 'Atlantic Salmon', requested_qty: 20, accepted_qty: 16.5, short_qty: 3.5, received_at: '2026-05-13T09:00:00.000Z' },
          ],
        };
      }
      return null;
    });
  });

  it('renders daily operations sections for fill rate, inventory, and short-ships', async () => {
    renderDsrPage();

    expect(await screen.findByText('Daily Operations Report')).toBeInTheDocument();
    expect(screen.getByText('Vendor Fill Snapshot')).toBeInTheDocument();
    expect(screen.getByText('On-Hand by Category')).toBeInTheDocument();
    expect(screen.getByText('Short-Ship Exceptions')).toBeInTheDocument();

    await screen.findByText('$1,240.00');
    await waitFor(() => {
      expect(screen.getAllByText('94.5%').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('North Sea').length).toBeGreaterThan(0);
    expect(screen.getByText('Seafood')).toBeInTheDocument();
    expect(screen.getByText('Atlantic Salmon')).toBeInTheDocument();
    expect(screen.getAllByText('Blue Crab Cafe').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith(expect.stringContaining('/api/reporting/daily-ops?date='));
    });
  });
});
