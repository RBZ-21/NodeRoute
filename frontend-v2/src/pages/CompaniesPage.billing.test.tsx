import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient } from '../test/renderWithQueryClient';
import { CompaniesPage } from './CompaniesPage';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  fetchListWithAuth: (url: string) =>
    fetchWithAuthMock(url).then((d: unknown) => {
      if (!Array.isArray(d)) throw new Error(`Expected a list response from ${url}`);
      return d;
    }),
  sendWithAuth: sendWithAuthMock,
}));

vi.mock('./superadmin/ClientBillingDrawer', () => ({
  ClientBillingDrawer: ({
    companyId,
    open,
  }: {
    companyId: string | null;
    open: boolean;
  }) => (open ? <div role="dialog">Billing company id: {companyId}</div> : null),
}));

const company = {
  id: 'company-billing-1',
  name: 'Acme Seafood',
  slug: 'acme-seafood',
  plan: 'track',
  status: 'active' as const,
  portal_ordering_enabled: false,
  user_count: 4,
  admin_email: 'admin@acme.example',
  created_at: '2026-01-15T00:00:00Z',
  business_types: ['seafood'],
  enabled_units: [],
  onboarding_completed: true,
};

const analytics = {
  total_companies: 1,
  onboarding_completed: 1,
  onboarding_incomplete: 0,
  by_vertical: [],
  feature_adoption: [],
  tier_violations: [],
};

describe('CompaniesPage billing action', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/superadmin/companies') return [company];
      if (url === '/api/superadmin/analytics/verticals') return analytics;
      return null;
    });
    sendWithAuthMock.mockResolvedValue({});
  });

  it('opens billing drawer for the selected tenant company', async () => {
    renderWithQueryClient(<CompaniesPage />);

    expect(await screen.findByText(company.name)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(company.id);
  });
});
