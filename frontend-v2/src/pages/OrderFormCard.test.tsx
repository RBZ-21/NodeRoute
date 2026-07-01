import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderFormCard } from './OrderFormCard';
import { emptyLine } from './orders.types';

const { fetchWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  getUserRole: () => 'admin',
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
    applyLines: vi.fn(),
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

describe('OrderFormCard pricing lookup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/order-guides')) return { guides: [] };
      if (url.startsWith('/api/customer-messages')) return { messages: [] };
      if (url.startsWith('/api/pricing/resolve')) return { price: 12.5, method: 'customer' };
      return {};
    });
  });

  function pricingCalls() {
    return fetchWithAuthMock.mock.calls.filter(([url]) => String(url).startsWith('/api/pricing/resolve'));
  }

  it('debounces pricing resolves and ignores non-pricing line changes', async () => {
    const line = {
      ...emptyLine(),
      productId: 'product-1',
      name: 'Salmon',
      quantity: '2',
      unit: 'each' as const,
      notes: '',
    };
    const { rerender, props } = renderOrderForm({
      customerName: 'Oceanview Market',
      customerEmail: 'buyer@oceanview.test',
      customerAddress: '123 Harbor St',
      customers: [{ id: 'cust-1', company_name: 'Oceanview Market' }],
      lines: [line],
    });

    expect(pricingCalls()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(349);
      await Promise.resolve();
    });
    expect(pricingCalls()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pricingCalls()).toHaveLength(1);

    rerender(<OrderFormCard {...props} customerName="Oceanview Market" customerEmail="buyer@oceanview.test" customerAddress="123 Harbor St" customers={[{ id: 'cust-1', company_name: 'Oceanview Market' }]} lines={[{ ...line, notes: 'pack separately' }]} />);

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pricingCalls()).toHaveLength(1);
  });
});
