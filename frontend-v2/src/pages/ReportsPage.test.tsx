import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsPage } from './ReportsPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

function renderReportsPage() {
  return renderWithQueryClient(<ReportsPage />);
}

describe('ReportsPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/reporting/sales-summary?preset=daily') {
        return {
          generated_at: '2026-05-01T12:00:00.000Z',
          filters: { preset: 'daily', start: '2026-05-01T00:00:00.000Z', end: '2026-05-01T23:59:59.999Z', item: null },
          overview: {
            total_sales: 1240,
            delivery_sales: 910,
            pickup_sales: 330,
            unknown_sales: 0,
            invoice_count: 4,
            order_count: 5,
            average_invoice: 310,
            item_count: 2,
          },
          items: [
            {
              key: 'lob-001',
              label: 'Lobster',
              item_number: 'LOB-001',
              qty: 14,
              revenue: 700,
              invoice_count: 3,
              delivery_revenue: 520,
              pickup_revenue: 180,
            },
            {
              key: 'sal-001',
              label: 'Atlantic Salmon',
              item_number: 'SAL-001',
              qty: 9,
              revenue: 540,
              invoice_count: 2,
              delivery_revenue: 390,
              pickup_revenue: 150,
            },
          ],
          available_items: [
            { key: 'lob-001', label: 'Lobster', item_number: 'LOB-001' },
            { key: 'sal-001', label: 'Atlantic Salmon', item_number: 'SAL-001' },
          ],
        };
      }
      return {
        generated_at: '2026-05-01T12:00:00.000Z',
        filters: { preset: 'daily', start: '2026-05-01T00:00:00.000Z', end: '2026-05-01T23:59:59.999Z', item: null },
        overview: {
          total_sales: 0,
          delivery_sales: 0,
          pickup_sales: 0,
          unknown_sales: 0,
          invoice_count: 0,
          order_count: 0,
          average_invoice: 0,
          item_count: 0,
        },
        items: [],
        available_items: [],
      };
    });
  });

  it('renders the sales summary and item rows', async () => {
    renderReportsPage();

    expect(await screen.findByText('Sales Reports')).toBeInTheDocument();
    expect(await screen.findByText('$1,240.00')).toBeInTheDocument();
    expect(screen.getByText('$910.00')).toBeInTheDocument();
    expect(screen.getByText('$330.00')).toBeInTheDocument();
    expect(screen.getByText('Lobster')).toBeInTheDocument();
    expect(screen.getByText('#LOB-001')).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/reporting/sales-summary?preset=daily');
    });
  });

  it('loads a custom range report when range filters are changed', async () => {
    renderReportsPage();

    await screen.findByText('Sales Reports');
    fireEvent.click(screen.getByRole('button', { name: 'Range' }));
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-04-01' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-04-30' } });

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/reporting/sales-summary?preset=range&start=2026-04-01&end=2026-04-30');
    });
  });

  it('exports the visible item sales rows as CSV', async () => {
    const createObjectURL = vi.fn(() => 'blob:reports-item-sales');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderReportsPage();

    await screen.findByText('Lobster');
    fireEvent.click(screen.getByRole('button', { name: 'Export Item Sales CSV' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain('"Item","Item Number","Qty Sold","Revenue","Delivery Sales","Pickup Sales","Invoices"');
    expect(csv).toContain('"Lobster","LOB-001","14","700","520","180","3"');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:reports-item-sales');
  });
});
