import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceabilityPage } from './TraceabilityPage';

const { fetchWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

const traceResponse = {
  lot: {
    lot_number: 'SALMON-2026-001',
    product: 'Atlantic Salmon',
    vendor: 'North Sea',
    received_date: '2026-04-01',
    received_by: 'Alex',
    quantity_received: 100,
    unit_of_measure: 'lb',
    expiration_date: '2026-04-20',
  },
  orders: [
    { order_id: 'o1', order_number: 'ORD-100', customer: 'Blue Fin', status: 'invoiced', quantity: 25, delivery_date: '2026-04-05' },
  ],
  stops: [
    { stop_id: 's1', stop_name: 'Blue Fin Dock', address: '1 Dock St', quantity: 25, delivered_at: '2026-04-05' },
  ],
};

const reportResponse = {
  page: 1,
  page_size: 50,
  total: 2,
  rows: [
    {
      lot_number: 'SALMON-2026-001',
      product_id: 'SAL-01',
      vendor: 'North Sea',
      received_date: '2026-04-01',
      qty_received: 100,
      unit_of_measure: 'lb',
      qty_shipped: 25,
      qty_remaining: 75,
      expiration_date: '2026-04-20',
    },
  ],
};

function mockTraceabilityApi() {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/lots/SALMON-2026-001/trace') return traceResponse;
    if (url.startsWith('/api/lots/traceability/report?')) return reportResponse;
    return [];
  });
}

describe('TraceabilityPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    mockTraceabilityApi();
  });

  it('runs a lot trace lookup and renders receiving, order, and stop history', async () => {
    render(<TraceabilityPage />);

    expect(await screen.findByText(/Showing 1 of 2 lots/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. SALMON-2026-001'), { target: { value: 'SALMON-2026-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trace' }));

    expect(await screen.findByText('Lot Record')).toBeInTheDocument();
    expect(screen.getByText('Atlantic Salmon')).toBeInTheDocument();
    expect(screen.getByText('ORD-100')).toBeInTheDocument();
    expect(screen.getByText('Blue Fin Dock')).toBeInTheDocument();
  });

  it('runs the report with filters and surfaces report errors', async () => {
    render(<TraceabilityPage />);

    expect(await screen.findByText(/Showing 1 of 2 lots/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('SALMON-2026'), { target: { value: 'SALMON' } });
    fireEvent.change(screen.getByPlaceholderText('SAL-01'), { target: { value: 'SAL-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Report' }));

    await waitFor(() => {
      expect(
        fetchWithAuthMock.mock.calls.some(([url]) =>
          String(url).includes('/api/lots/traceability/report?page=1&limit=50&lot=SALMON&product_id=SAL-01')
        )
      ).toBe(true);
    });

    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/lots/traceability/report?')) throw new Error('Report backend unavailable');
      return [];
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run Report' }));
    expect(await screen.findByText('Report backend unavailable')).toBeInTheDocument();
  });
});
