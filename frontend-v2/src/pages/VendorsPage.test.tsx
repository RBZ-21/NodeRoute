import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorsPage } from './VendorsPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock, navigateMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
  navigateMock: vi.fn(),
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

function renderVendorsPage() {
  return renderWithQueryClient(<VendorsPage />, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });
}

describe('VendorsPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    navigateMock.mockReset();

    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/vendors') {
        return [
          {
            id: 'vendor-1',
            vendorId: 'vendor-1',
            name: 'Blue Ocean Seafood',
            status: 'active',
            category: 'Seafood',
            catalog_item_numbers: ['SAL-1'],
            activePOs: 2,
          },
        ];
      }
      if (url === '/api/inventory') {
        return [
          { item_number: 'SAL-1', description: 'Fresh Salmon', unit: 'lb', category: 'Seafood' },
          { item_number: 'BOX-1', description: 'Shipping Box', unit: 'ea', category: 'Packaging' },
        ];
      }
      return [];
    });
  });

  it('saves scoped vendor catalog item numbers from the vendor drawer', async () => {
    sendWithAuthMock.mockResolvedValueOnce({
      id: 'vendor-1',
      vendorId: 'vendor-1',
      name: 'Blue Ocean Seafood',
      status: 'active',
      category: 'Seafood',
      catalog_item_numbers: ['SAL-1', 'BOX-1'],
      activePOs: 2,
    });

    renderVendorsPage();

    expect(await screen.findByText('Blue Ocean Seafood')).toBeInTheDocument();
    expect(screen.getByText('1 SKU')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    const scopedMatches = await screen.findAllByText((_, element) => (element?.textContent || '').includes('Scoped to 1 SKU'));
    expect(scopedMatches.length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Search catalog items'), { target: { value: 'Shipping Box' } });
    fireEvent.click(screen.getByLabelText('Shipping Box BOX-1'));
    expect(await screen.findByText('Scoped to 2 SKUs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/vendors/vendor-1', 'PATCH', expect.objectContaining({
        catalog_item_numbers: ['BOX-1', 'SAL-1'],
      }));
    });
  });
});
