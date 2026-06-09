import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderFormCard } from './OrderFormCard';
import { emptyLine } from './orders.types';

const { fetchWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

vi.mock('../hooks/useRoutes', () => ({
  useRoutes: () => ({ data: [] }),
}));

function renderOrderForm(overrides: Partial<React.ComponentProps<typeof OrderFormCard>> = {}) {
  const setCustomerName = vi.fn();
  const setCustomerAddress = vi.fn();
  const setRouteId = vi.fn();
  const props: React.ComponentProps<typeof OrderFormCard> = {
    editingOrderId: null,
    customerName: '',
    setCustomerName,
    customerEmail: '',
    setCustomerEmail: vi.fn(),
    customerPhone: '',
    setCustomerPhone: vi.fn(),
    customerAddress: '',
    setCustomerAddress,
    fulfillmentType: 'delivery',
    setFulfillmentType: vi.fn(),
    routeId: '',
    setRouteId,
    customers: [],
    notes: '',
    setNotes: vi.fn(),
    taxEnabled: false,
    setTaxEnabled: vi.fn(),
    taxRate: '',
    setTaxRate: vi.fn(),
    fuelPercent: '',
    setFuelPercent: vi.fn(),
    servicePercent: '',
    setServicePercent: vi.fn(),
    minimumFlat: '',
    setMinimumFlat: vi.fn(),
    lines: [emptyLine()],
    products: [],
    lotsCache: {},
    ftlSet: new Set(),
    catchWeightSet: new Set(),
    subtotal: 0,
    charges: [],
    draftTotal: 0,
    updateLine: vi.fn(),
    toggleLineCatchWeight: vi.fn(),
    addLine: vi.fn(),
    removeLine: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    submitting: false,
    productsLoading: false,
    ...overrides,
  };
  return {
    ...render(<OrderFormCard {...props} />),
    props,
    setCustomerName,
    setCustomerAddress,
    setRouteId,
  };
}

describe('OrderFormCard address lookup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchWithAuthMock.mockReset();
  });

  it('disables autocomplete lookups after the address service is unavailable', async () => {
    fetchWithAuthMock.mockRejectedValue(new Error('GOOGLE_MAPS_KEY is not configured on the server'));
    const { rerender, props, setCustomerName } = renderOrderForm();
    const customerInput = screen.getByPlaceholderText('Oceanview Market');

    fireEvent.change(customerInput, { target: { value: 'Pier Cafe' } });
    expect(setCustomerName).toHaveBeenCalledWith('Pier Cafe');
    rerender(<OrderFormCard {...props} customerName="Pier Cafe" />);
    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
    expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/customers/address-lookup?name=Pier%20Cafe');

    fireEvent.change(customerInput, { target: { value: 'Pier Cafe South' } });
    rerender(<OrderFormCard {...props} customerName="Pier Cafe South" />);
    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
  });

  it('hydrates a saved customer route when a customer is selected', () => {
    const setFulfillmentType = vi.fn();
    const { setRouteId } = renderOrderForm({
      setFulfillmentType,
      customers: [
        {
          id: 'cust-1',
          company_name: 'Oceanview Market',
          billing_email: 'buyer@oceanview.test',
          address: '123 Harbor St',
          phone_number: '555-0101',
          default_route_id: 'route-north',
        },
      ],
    });

    fireEvent.change(screen.getByPlaceholderText('Oceanview Market'), { target: { value: 'Oceanview Market' } });

    expect(setRouteId).toHaveBeenCalledWith('route-north');
    expect(setFulfillmentType).toHaveBeenCalledWith('delivery');
  });
});
