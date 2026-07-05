import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompaniesPage } from './CompaniesPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

vi.mock('./superadmin/ClientBillingDrawer', () => ({
  ClientBillingDrawer: ({ open, companyId }: { open: boolean; companyId: string | null }) =>
    open ? <div role="dialog">Billing drawer {companyId}</div> : null,
}));

describe('CompaniesPage billing action', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/superadmin/companies') {
        return [{ id: 'company-1', name: 'Blue Harbor', plan: 'track', status: 'trial', admin_email: 'admin@test.com', user_count: 2 }];
      }
      if (url === '/api/superadmin/analytics/verticals') return null;
      return null;
    });
  });

  it('opens billing drawer for a tenant company', async () => {
    renderWithQueryClient(<CompaniesPage />);
    expect(await screen.findByText('Blue Harbor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('company-1');
  });
});
