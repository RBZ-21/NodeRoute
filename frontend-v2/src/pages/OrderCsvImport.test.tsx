import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderCsvImport } from './OrderCsvImport';

const { sendWithAuthMock } = vi.hoisted(() => ({ sendWithAuthMock: vi.fn() }));

vi.mock('../lib/api', () => ({
  sendWithAuth: sendWithAuthMock,
}));

function makeCsvFile(content: string): File {
  const file = new File([content], 'orders.csv', { type: 'text/csv' });
  // jsdom's File.text() is available, but guard for older environments.
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  }
  return file;
}

async function uploadAndPreview(csv: string) {
  render(<OrderCsvImport open onClose={() => {}} onImported={() => {}} />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [makeCsvFile(csv)] } });
  // auto-mapping moves to the map step; click through to preview.
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
}

describe('OrderCsvImport', () => {
  beforeEach(() => {
    sendWithAuthMock.mockReset();
  });

  it('flags malformed rows and disables import until they are fixed', async () => {
    const csv =
      'customer_name,customer_address,item_number,quantity\n' +
      'Harbor Cafe,123 Harbor St,SAL-01,10\n' +
      ',456 Dock Rd,TUN-01,5\n' +        // missing customer name
      'Pier Diner,99 Pier Ave,COD-01,0\n'; // zero quantity

    await uploadAndPreview(csv);

    expect(await screen.findByText(/2 of 3 rows have errors/)).toBeInTheDocument();
    expect(screen.getByText('Missing customer name')).toBeInTheDocument();
    expect(screen.getByText('Quantity must be > 0')).toBeInTheDocument();

    // Import button is disabled while any row has errors → no partial commit.
    const importButton = screen.getByRole('button', { name: /Import .* Order Row/ });
    expect(importButton).toBeDisabled();
    expect(sendWithAuthMock).not.toHaveBeenCalled();
  });

  it('commits a clean CSV via the bulk-import endpoint', async () => {
    sendWithAuthMock.mockResolvedValueOnce({ committed: 2 });
    const onImported = vi.fn();
    render(<OrderCsvImport open onClose={() => {}} onImported={onImported} />);

    const csv =
      'customer_name,customer_address,item_number,quantity\n' +
      'Harbor Cafe,123 Harbor St,SAL-01,10\n' +
      'Pier Diner,99 Pier Ave,COD-01,4\n';
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeCsvFile(csv)] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    expect(await screen.findByText(/All 2 rows valid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Import 2 Order Row/ }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/orders/bulk-import', 'POST', expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ customer_name: 'Harbor Cafe' }),
          expect.objectContaining({ customer_name: 'Pier Diner' }),
        ]),
      }));
      expect(onImported).toHaveBeenCalledWith(2);
    });
  });
});
