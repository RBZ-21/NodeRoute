import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, getUserRole, sendWithAuth } from '../lib/api';
import { useRoutes } from '../hooks/useRoutes';
import { asMoney, asNumber, fmtDate, normalizeText, productSelectionKey } from './orders.types';
import type { Customer, InventoryProduct, LotCode, OrderCharge, OrderLineDraft } from './orders.types';

type Props = {
  editingOrderId: string | null;
  customerName: string; setCustomerName: (v: string) => void;
  customerEmail: string; setCustomerEmail: (v: string) => void;
  customerPhone: string; setCustomerPhone: (v: string) => void;
  customerAddress: string; setCustomerAddress: (v: string) => void;
  fulfillmentType: 'delivery' | 'pickup'; setFulfillmentType: (v: 'delivery' | 'pickup') => void;
  routeId: string; setRouteId: (v: string) => void;
  customers: Customer[];
  notes: string; setNotes: (v: string) => void;
  taxEnabled: boolean; setTaxEnabled: (v: boolean) => void;
  taxRate: string; setTaxRate: (v: string) => void;
  fuelPercent: string; setFuelPercent: (v: string) => void;
  servicePercent: string; setServicePercent: (v: string) => void;
  minimumFlat: string; setMinimumFlat: (v: string) => void;
  lines: OrderLineDraft[];
  products: InventoryProduct[];
  lotsCache: Record<string, LotCode[]>;
  ftlSet: Set<string>;
  catchWeightSet: Set<string>;
  subtotal: number;
  charges: OrderCharge[];
  draftTotal: number;
  updateLine: (index: number, key: keyof OrderLineDraft, value: string) => void;
  toggleLineCatchWeight: (index: number) => void;
  addLine: () => void;
  applyLines: (lines: OrderLineDraft[]) => void;
  removeLine: (index: number) => void;
  onSubmit: (sendToProcessing: boolean) => void;
  onCancel: () => void;
  submitting: boolean;
  productsLoading?: boolean;
  validationErrors?: OrderFormValidationErrors;
};

type ResolvedLinePrice = {
  price: number;
  method: string;
  source_id?: string | null;
  minimum_sell?: {
    allowed: boolean;
    min_price: number | null;
    source_id?: string | null;
  };
};

type OrderGuideItem = {
  product_id: string;
  default_qty?: number | string | null;
  default_uom?: string | null;
  sort_order?: number | string | null;
};

type OrderGuide = {
  id: string;
  name: string;
  items?: OrderGuideItem[];
};

type HotMessage = {
  id?: string;
  message: string;
  message_type?: string;
};

type ScanResponse = {
  action?: string;
  order?: {
    items?: Array<Record<string, unknown>>;
  };
};

function normalizeResolvedLinePrice(value: unknown): ResolvedLinePrice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ResolvedLinePrice>;
  if (candidate.price == null) return null;
  const price = asNumber(candidate.price);
  if (!Number.isFinite(price)) return null;
  return {
    ...candidate,
    price,
    method: String(candidate.method || 'resolved'),
  };
}

export type OrderFormValidationErrors = Partial<Record<
  'customerName' | 'customerEmail' | 'customerAddress' | 'items',
  string
>>;

function isAddressLookupServiceUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /503|GOOGLE_MAPS_KEY|not configured|temporarily unavailable|Address lookup failed/i.test(message);
}

export function OrderFormCard({
  editingOrderId,
  customerName, setCustomerName,
  customerEmail, setCustomerEmail,
  customerPhone, setCustomerPhone,
  customerAddress, setCustomerAddress,
  fulfillmentType, setFulfillmentType,
  routeId, setRouteId,
  customers,
  notes, setNotes,
  taxEnabled, setTaxEnabled,
  taxRate, setTaxRate,
  fuelPercent, setFuelPercent,
  servicePercent, setServicePercent,
  minimumFlat, setMinimumFlat,
  lines, products, lotsCache, ftlSet, catchWeightSet,
  subtotal, charges, draftTotal,
  updateLine, toggleLineCatchWeight, addLine, removeLine,
  applyLines,
  onSubmit, onCancel, submitting, productsLoading = false,
  validationErrors = {},
}: Props) {
  const { data: routes = [] } = useRoutes();
  const userRole = getUserRole();

  const lookupInFlightRef = useRef<string | null>(null);
  const lookupDisabledRef = useRef(false);
  const lookupCacheRef = useRef<Record<string, string | null>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addressLookupLoading, setAddressLookupLoading] = useState(false);
  const [browseLineIndex, setBrowseLineIndex] = useState<number | null>(null);
  const [browseSearch, setBrowseSearch] = useState('');
  const [resolvedLinePrices, setResolvedLinePrices] = useState<Record<number, ResolvedLinePrice>>({});
  const [pricingError, setPricingError] = useState('');
  const [orderGuides, setOrderGuides] = useState<OrderGuide[]>([]);
  const [hotMessages, setHotMessages] = useState<HotMessage[]>([]);
  const [selectedGuideId, setSelectedGuideId] = useState('');
  const [workflowError, setWorkflowError] = useState('');
  const [workflowNotice, setWorkflowNotice] = useState('');
  const [barcodeValue, setBarcodeValue] = useState('');
  const [scanLoading, setScanLoading] = useState(false);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function normalizedCustomerName(value: string) {
    return value.trim().toLowerCase();
  }

  function customerAddressValue(customer: Customer) {
    return String(
      customer.address
      || customer.billing_address
      || customer.customer_address
      || customer.delivery_address
      || customer.shipping_address
      || customer.ship_to_address
      || ''
    ).trim();
  }

  function customerRouteValue(customer: Customer) {
    return String(customer.default_route_id || customer.route_id || customer.assigned_route_id || '').trim();
  }

  const maybeLookupAddress = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (trimmed.length < 3 || lookupDisabledRef.current) return;
    const cacheKey = normalizedCustomerName(trimmed);
    if (lookupCacheRef.current[cacheKey] !== undefined) {
      const cachedAddress = lookupCacheRef.current[cacheKey];
      if (cachedAddress) setCustomerAddress(cachedAddress);
      return;
    }
    if (lookupInFlightRef.current === cacheKey) return;
    lookupInFlightRef.current = cacheKey;
    setAddressLookupLoading(true);
    try {
      const result = await fetchWithAuth<{ address?: string }>(
        `/api/customers/address-lookup?name=${encodeURIComponent(trimmed)}`
      );
      const address = String(result?.address || '').trim();
      lookupCacheRef.current[cacheKey] = address || null;
      if (address) setCustomerAddress(address);
    } catch (error) {
      lookupCacheRef.current[cacheKey] = null;
      if (isAddressLookupServiceUnavailable(error)) {
        lookupDisabledRef.current = true;
      }
    } finally {
      lookupInFlightRef.current = null;
      setAddressLookupLoading(false);
    }
  }, [setCustomerAddress]);

  const hydrateCustomerDetails = useCallback((customer: Customer) => {
    setCustomerName(customer.company_name || '');
    setCustomerEmail(customer.billing_email || '');
    setCustomerPhone(customer.phone_number || '');
    const addr = customerAddressValue(customer);
    setCustomerAddress(addr);
    const savedRouteId = customerRouteValue(customer);
    setRouteId(savedRouteId);
    if (savedRouteId) setFulfillmentType('delivery');
    if (!addr && customer.company_name) {
      void maybeLookupAddress(customer.company_name);
    }
  }, [maybeLookupAddress, setCustomerAddress, setCustomerEmail, setCustomerName, setCustomerPhone, setFulfillmentType, setRouteId]);

  const hydrateCustomerByName = useCallback((nextName: string) => {
    const normalized = normalizedCustomerName(nextName);
    if (!normalized) return false;
    const match = customers.find((customer) => normalizedCustomerName(customer.company_name || '') === normalized);
    if (!match) return false;
    hydrateCustomerDetails(match);
    return true;
  }, [customers, hydrateCustomerDetails]);

  // Call the latest hydrate via a ref so the effect subscribes to customer
  // data changes without depending on the callback identity each render.
  const hydrateCustomerByNameRef = useRef(hydrateCustomerByName);
  hydrateCustomerByNameRef.current = hydrateCustomerByName;
  useEffect(() => {
    if (!customerName.trim()) return;
    if (customerEmail.trim() || customerAddress.trim() || customerPhone.trim()) return;
    hydrateCustomerByNameRef.current(customerName);
  }, [customerAddress, customerEmail, customerName, customerPhone, customers]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      label: c.company_name || '',
      sublabel: [c.phone_number, c.billing_email].filter(Boolean).join(' · '),
      value: c.id,
    })),
    [customers],
  );

  const productOptions = useMemo(
    () => products.map((p) => ({
      label: p.description,
      sublabel: `${normalizeText(p.item_number) ? '#' + normalizeText(p.item_number) : 'No item #'}${p.unit ? ' · ' + p.unit : ''}${asNumber(p.cost) > 0 ? ' · $' + asNumber(p.cost).toFixed(2) : ''}`,
      value: productSelectionKey(p),
    })),
    [products],
  );

  const selectedCustomerId = useMemo(() => {
    const normalized = normalizedCustomerName(customerName);
    if (!normalized) return '';
    return customers.find((customer) => normalizedCustomerName(customer.company_name || '') === normalized)?.id || '';
  }, [customerName, customers]);

  function lineDraftFromProduct(product: InventoryProduct | undefined, guideItem: Partial<OrderGuideItem> = {}): OrderLineDraft {
    const qty = String(guideItem.default_qty ?? '1');
    const itemNumber = normalizeText(product?.item_number);
    const productId = normalizeText(product?.id || guideItem.product_id);
    const isCatchWeight = !!product?.is_catch_weight;
    const defaultUnit = normalizeText(guideItem.default_uom || product?.unit).toLowerCase() === 'lb' ? 'lb' : 'each';
    return {
      productId,
      name: normalizeText(product?.description) || itemNumber || productId,
      itemNumber,
      unit: isCatchWeight ? 'lb' : defaultUnit,
      quantity: isCatchWeight ? '' : qty,
      requestedWeight: !isCatchWeight && defaultUnit === 'lb' ? qty : '',
      unitPrice: !isCatchWeight && asNumber(product?.cost) > 0 ? String(asNumber(product?.cost)) : '',
      notes: '',
      lotId: '',
      isCatchWeight,
      estimatedWeight: isCatchWeight ? qty : '',
      pricePerLb: isCatchWeight && product?.default_price_per_lb != null ? String(asNumber(product.default_price_per_lb)) : '',
    };
  }

  function lineDraftFromOrderItem(item: Record<string, unknown>): OrderLineDraft {
    const productId = normalizeText(item.product_id);
    const itemNumber = normalizeText(item.item_number);
    const product = products.find((candidate) =>
      normalizeText(candidate.id) === productId
      || (itemNumber && normalizeText(candidate.item_number) === itemNumber)
    );
    const isCatchWeight = item.is_catch_weight === true;
    const unit = isCatchWeight || normalizeText(item.unit).toLowerCase() === 'lb' ? 'lb' : 'each';
    return {
      productId: productId || normalizeText(product?.id),
      name: normalizeText(item.name || item.description || product?.description),
      itemNumber: itemNumber || normalizeText(product?.item_number),
      unit,
      quantity: isCatchWeight ? '' : String(item.requested_qty ?? item.quantity ?? ''),
      requestedWeight: !isCatchWeight && unit === 'lb' ? String(item.requested_weight ?? item.quantity ?? '') : '',
      unitPrice: isCatchWeight ? '' : String(item.unit_price ?? item.price ?? ''),
      notes: normalizeText(item.notes),
      lotId: normalizeText(item.lot_id),
      isCatchWeight,
      estimatedWeight: isCatchWeight ? String(item.estimated_weight ?? item.requested_weight ?? item.quantity ?? '') : '',
      pricePerLb: isCatchWeight ? String(item.price_per_lb ?? item.unit_price ?? '') : '',
    };
  }

  useEffect(() => {
    let cancelled = false;
    async function loadWorkflowContext() {
      if (!selectedCustomerId) {
        setOrderGuides([]);
        setHotMessages([]);
        setSelectedGuideId('');
        setWorkflowError('');
        return;
      }
      try {
        const [guidesResult, messagesResult] = await Promise.all([
          fetchWithAuth<{ guides?: OrderGuide[] }>(`/api/order-guides?customerId=${encodeURIComponent(selectedCustomerId)}`),
          fetchWithAuth<{ messages?: HotMessage[] }>(`/api/customer-messages?customerId=${encodeURIComponent(selectedCustomerId)}&type=order_entry`),
        ]);
        if (!cancelled) {
          setOrderGuides(guidesResult.guides || []);
          setHotMessages(messagesResult.messages || []);
          setWorkflowError('');
        }
      } catch (error) {
        if (!cancelled) {
          setOrderGuides([]);
          setHotMessages([]);
          setWorkflowError(String((error as Error)?.message || 'Could not load customer order context'));
        }
      }
    }
    void loadWorkflowContext();
    return () => { cancelled = true; };
  }, [selectedCustomerId]);

  const pricingLookupKey = useMemo(
    () => lines.map((line) => [
      normalizeText(line.productId),
      normalizeText(line.itemNumber),
      line.quantity,
      line.requestedWeight,
      line.estimatedWeight,
      line.unit,
      line.isCatchWeight ? 'cw' : 'std',
    ].join(':')).join('|'),
    [lines],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadResolvedPrices() {
      if (!selectedCustomerId) {
        setResolvedLinePrices({});
        setPricingError('');
        return;
      }

      const lookups = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => normalizeText(line.productId) || normalizeText(line.itemNumber));

      if (!lookups.length) {
        setResolvedLinePrices({});
        setPricingError('');
        return;
      }

      try {
        const entries = await Promise.all(lookups.map(async ({ line, index }) => {
          const productId = normalizeText(line.productId) || `item:${normalizeText(line.itemNumber)}`;
          const qty = line.isCatchWeight
            ? asNumber(line.estimatedWeight)
            : line.unit === 'lb'
              ? asNumber(line.requestedWeight || line.quantity)
              : asNumber(line.quantity);
          const result = await fetchWithAuth<unknown>(
            `/api/pricing/resolve?customerId=${encodeURIComponent(selectedCustomerId)}&productId=${encodeURIComponent(productId)}&qty=${encodeURIComponent(String(qty || 1))}&uom=${encodeURIComponent(line.unit || '')}`,
          );
          const normalized = normalizeResolvedLinePrice(result);
          return normalized ? ([index, normalized] as const) : null;
        }));
        if (!cancelled) {
          setResolvedLinePrices(Object.fromEntries(entries.filter((entry): entry is readonly [number, ResolvedLinePrice] => Boolean(entry))));
          setPricingError('');
        }
      } catch (error) {
        if (!cancelled) {
          setPricingError(String((error as Error)?.message || 'Could not resolve line pricing'));
          setResolvedLinePrices({});
        }
      }
    }

    void loadResolvedPrices();
    return () => { cancelled = true; };
  }, [lines, pricingLookupKey, selectedCustomerId]);

  const browsableProducts = useMemo(() => {
    const needle = normalizeText(browseSearch).toLowerCase();
    return products
      .filter((product) => {
        if (!needle) return true;
        return [
          product.description,
          product.item_number,
          product.unit,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const stockDelta = asNumber(b.on_hand_qty) - asNumber(a.on_hand_qty);
        if (stockDelta !== 0) return stockDelta;
        return String(a.description || '').localeCompare(String(b.description || ''));
      });
  }, [browseSearch, products]);

  function applyProductSelection(index: number, product: InventoryProduct) {
    updateLine(index, 'productId', productSelectionKey(product));
    setBrowseLineIndex(null);
    setBrowseSearch('');
  }

  function applySelectedGuide() {
    const guide = orderGuides.find((candidate) => candidate.id === selectedGuideId);
    if (!guide) return;
    const nextLines = (guide.items || [])
      .slice()
      .sort((a, b) => asNumber(a.sort_order) - asNumber(b.sort_order))
      .map((item) => lineDraftFromProduct(products.find((product) => normalizeText(product.id) === normalizeText(item.product_id)), item));
    if (!nextLines.length) return;
    applyLines(nextLines);
    setWorkflowNotice(`Applied ${guide.name}.`);
  }

  async function scanBarcode() {
    const barcode = barcodeValue.trim();
    if (!editingOrderId || !barcode || scanLoading) return;
    setScanLoading(true);
    setWorkflowError('');
    setWorkflowNotice('');
    try {
      const result = await sendWithAuth<ScanResponse>(`/api/orders/${encodeURIComponent(editingOrderId)}/scan`, 'POST', { barcode });
      const nextItems = result.order?.items || [];
      if (nextItems.length) applyLines(nextItems.map(lineDraftFromOrderItem));
      setBarcodeValue('');
      setWorkflowNotice(result.action === 'duplicate' ? 'Barcode already scanned for this draft.' : 'Barcode scan applied.');
    } catch (error) {
      setWorkflowError(String((error as Error)?.message || 'Could not scan barcode'));
    } finally {
      setScanLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editingOrderId ? 'Edit Order' : 'Create Order'}</CardTitle>
        <CardDescription>
          FTL-flagged products require a lot assignment (FSMA 204). Select the soonest-to-expire lot first (FEFO).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Customer Name</span>
            <Combobox
              value={customerName}
              onChange={(nextValue) => {
                setCustomerName(nextValue);
                const matched = hydrateCustomerByName(nextValue);
                if (!matched) {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  if (nextValue.trim()) {
                    debounceRef.current = setTimeout(() => {
                      void maybeLookupAddress(nextValue);
                    }, 800);
                  }
                }
              }}
              onSelect={(opt) => {
                const c = customers.find((x) => x.id === opt.value);
                if (!c) return;
                hydrateCustomerDetails(c);
              }}
              options={customerOptions}
              placeholder="Oceanview Market"
            />
            {validationErrors.customerName && (
              <p className="text-xs text-destructive">{validationErrors.customerName}</p>
            )}
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Delivery Type</span>
            <select
              value={fulfillmentType}
              onChange={(e) => setFulfillmentType(e.target.value === 'pickup' ? 'pickup' : 'delivery')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="delivery">Delivery</option>
              <option value="pickup">Pickup</option>
            </select>
          </label>
          {fulfillmentType === 'delivery' && (
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Assign to Route</span>
              <select
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— No route —</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || r.id}{r.driver ? ` · ${r.driver}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Customer Email</span>
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="buyer@customer.com" />
            {validationErrors.customerEmail && (
              <p className="text-xs text-destructive">{validationErrors.customerEmail}</p>
            )}
            {customerPhone && <p className="text-xs text-muted-foreground pt-0.5">📞 {customerPhone}</p>}
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">
              Customer Address
              {addressLookupLoading && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground animate-pulse">Looking up…</span>
              )}
            </span>
            <Input
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder={fulfillmentType === 'delivery' ? '123 Harbor St' : 'Pickup order'}
              disabled={fulfillmentType === 'pickup'}
            />
            {validationErrors.customerAddress && fulfillmentType === 'delivery' && (
              <p className="text-xs text-destructive">{validationErrors.customerAddress}</p>
            )}
          </label>
        </div>

        {fulfillmentType === 'delivery' ? (
          <p className="text-xs text-muted-foreground">Delivery orders keep the customer address and create a pending stop automatically.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Pickup orders do not create route stops.</p>
        )}
        <p className="text-xs text-muted-foreground">Out-of-stock items can still be added while the order is being built. Use <strong>Browse Inventory</strong> if the customer wants to see the current catalog.</p>

        {hotMessages.length ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {hotMessages.map((message) => (
              <div key={message.id || message.message}>{message.message}</div>
            ))}
          </div>
        ) : null}
        {workflowError && (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{workflowError}</div>
        )}
        {workflowNotice && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{workflowNotice}</div>
        )}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/20 p-3">
            <label className="min-w-56 flex-1 space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Order Guide</span>
              <select
                value={selectedGuideId}
                onChange={(event) => setSelectedGuideId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={!orderGuides.length}
              >
                <option value="">{orderGuides.length ? 'Select guide' : 'No guide'}</option>
                {orderGuides.map((guide) => (
                  <option key={guide.id} value={guide.id}>{guide.name}</option>
                ))}
              </select>
            </label>
            <Button type="button" variant="outline" onClick={applySelectedGuide} disabled={!selectedGuideId}>
              Apply
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/20 p-3">
            <label className="min-w-56 flex-1 space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Barcode Scan</span>
              <Input
                value={barcodeValue}
                onChange={(event) => setBarcodeValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void scanBarcode();
                  }
                }}
                placeholder="Scan or type barcode"
                disabled={!editingOrderId || scanLoading}
              />
            </label>
            <Button type="button" variant="outline" onClick={() => void scanBarcode()} disabled={!editingOrderId || !barcodeValue.trim() || scanLoading}>
              {scanLoading ? 'Scanning...' : 'Add'}
            </Button>
          </div>
        </div>

        <label className="space-y-1 text-sm">
          <span className="font-semibold text-muted-foreground">Notes</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special handling or packing notes" />
        </label>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Tax Enabled</span>
            <select value={taxEnabled ? 'yes' : 'no'} onChange={(e) => setTaxEnabled(e.target.value === 'yes')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Tax Rate</span>
            <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="0.09" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Fuel %</span>
            <Input value={fuelPercent} onChange={(e) => setFuelPercent(e.target.value)} placeholder="0" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Service % / Min $</span>
            <div className="flex gap-2">
              <Input value={servicePercent} onChange={(e) => setServicePercent(e.target.value)} placeholder="0" />
              <Input value={minimumFlat}    onChange={(e) => setMinimumFlat(e.target.value)}    placeholder="0" />
            </div>
          </label>
        </div>

        {validationErrors.items && (
          <p className="text-sm text-destructive">{validationErrors.items}</p>
        )}
        {pricingError && (
          <p className="text-sm text-destructive">{pricingError}</p>
        )}

        <div className="table-scroll-container overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Item #</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead><span title="Catch weight products are invoiced by actual measured weight">CW</span></TableHead>
                <TableHead>Qty / Est. Wt</TableHead>
                <TableHead>Unit Price / $/lb</TableHead>
                <TableHead>Line Total</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>
                  Lot
                  <span className="ml-1 text-xs font-normal text-amber-600">(FTL req'd)</span>
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const productLookupKey = normalizeText(line.productId) || line.itemNumber.trim();
                const isFtl    = ftlSet.has(productLookupKey);
                const isCw     = line.isCatchWeight || catchWeightSet.has(productLookupKey);
                const lots     = lotsCache[line.itemNumber.trim()] || [];
                const needsLot = isFtl && !line.lotId;
                const lineProduct = products.find((p) => productSelectionKey(p) === line.productId)
                  || (line.itemNumber.trim() ? products.find((p) => normalizeText(p.item_number) === line.itemNumber.trim()) : undefined);
                const landedCost = lineProduct ? asNumber(lineProduct.landed_cost) : 0;
                const realCost   = lineProduct ? asNumber(lineProduct.real_cost)   : 0;
                const lineTotal = isCw
                  ? asMoney(asNumber(line.estimatedWeight) * asNumber(line.pricePerLb))
                  : asMoney((line.unit === 'lb' ? asNumber(line.requestedWeight) : asNumber(line.quantity)) * asNumber(line.unitPrice));
                const resolvedPrice = resolvedLinePrices[index];
                const minSell = resolvedPrice?.minimum_sell;
                const belowMinimum = minSell && minSell.allowed === false && minSell.min_price != null;
                const canOverrideMinimum = userRole === 'admin' || userRole === 'superadmin';
                return (
                  <TableRow key={index} className={needsLot ? 'bg-amber-50/50' : ''}>
                    <TableCell>
                      <div className="min-w-[240px] space-y-2">
                        <Combobox
                          value={line.name}
                          onChange={(v) => updateLine(index, 'name', v)}
                          onSelect={(opt) => {
                            const matched = products.find((product) => productSelectionKey(product) === opt.value);
                            if (matched) {
                              applyProductSelection(index, matched);
                              return;
                            }
                            updateLine(index, 'name', opt.label);
                            updateLine(index, 'itemNumber', '');
                            updateLine(index, 'productId', '');
                          }}
                          options={productOptions}
                          disabled={productsLoading}
                          placeholder={productsLoading ? 'Loading products…' : 'Atlantic Salmon'}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={() => setBrowseLineIndex(index)}>
                          Browse Inventory
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input value={line.itemNumber} onChange={(e) => updateLine(index, 'itemNumber', e.target.value)} placeholder="Optional item #" />
                    </TableCell>
                    <TableCell>
                      {isCw ? (
                        <span className="inline-flex h-10 items-center px-3 text-sm text-muted-foreground">lb</span>
                      ) : (
                        <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={line.unit} onChange={(e) => updateLine(index, 'unit', e.target.value as 'lb' | 'each')}>
                          <option value="lb">lb</option>
                          <option value="each">each</option>
                        </select>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggleLineCatchWeight(index)}
                        title={line.isCatchWeight ? 'Catch weight ON — click to disable' : 'Enable catch weight for this line'}
                        aria-label={line.isCatchWeight ? 'Disable catch weight for this line' : 'Enable catch weight for this line'}
                        className={['inline-flex h-6 w-11 items-center rounded-full transition-colors', line.isCatchWeight ? 'bg-orange-500' : 'bg-gray-200'].join(' ')}
                      >
                        <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', line.isCatchWeight ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
                        <span className="sr-only">{line.isCatchWeight ? 'Catch weight on' : 'Catch weight off'}</span>
                      </button>
                    </TableCell>
                    <TableCell>
                      {isCw ? (
                        <div className="space-y-0.5">
                          <Input type="number" min="0" step="0.001" value={line.estimatedWeight}
                            onChange={(e) => updateLine(index, 'estimatedWeight', e.target.value)} placeholder="0.000 lbs" />
                          <p className="text-xs text-muted-foreground">Est. weight (lbs)</p>
                        </div>
                      ) : line.unit === 'lb' ? (
                        <div className="space-y-1">
                          <Input type="number" min="0" step="1" value={line.quantity}
                            onChange={(e) => updateLine(index, 'quantity', e.target.value)} placeholder="Qty" />
                          <Input type="number" min="0" step="0.001" value={line.requestedWeight}
                            onChange={(e) => updateLine(index, 'requestedWeight', e.target.value)} placeholder="Est. lbs" />
                          <p className="text-xs text-muted-foreground">Ordered qty and estimated total lbs</p>
                        </div>
                      ) : (
                        <Input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} />
                      )}
                    </TableCell>
                    <TableCell>
                      {isCw ? (
                        <div className="space-y-0.5">
                          <Input type="number" min="0" step="0.0001" value={line.pricePerLb}
                            onChange={(e) => updateLine(index, 'pricePerLb', e.target.value)} placeholder="0.0000" />
                          <p className="text-xs text-muted-foreground">$ per lb</p>
                        </div>
                      ) : (
                        <Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', e.target.value)} />
                      )}
                      {resolvedPrice && (
                        <div className="mt-1 space-y-1 text-[11px] leading-tight text-muted-foreground">
                          <div>Resolved {asMoney(asNumber(resolvedPrice.price))} · {resolvedPrice.method.replace(/_/g, ' ')}</div>
                          {belowMinimum && (
                            <Badge variant={canOverrideMinimum ? 'warning' : 'destructive'} className="whitespace-nowrap">
                              Min {asMoney(asNumber(minSell.min_price))}{canOverrideMinimum ? ' override' : ''}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {isCw
                        ? <span className="text-sm">{lineTotal}<span className="ml-1 text-xs text-muted-foreground">(est.)</span></span>
                        : lineTotal}
                      {(landedCost > 0 || realCost > 0) && (
                        <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                          {landedCost > 0 && <div title="Landed cost: base + freight, duties, handling">Landed {asMoney(landedCost)}</div>}
                          {realCost   > 0 && <div title="Real cost: true all-in cost after overrides">Real {asMoney(realCost)}</div>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input value={line.notes} onChange={(e) => updateLine(index, 'notes', e.target.value)} placeholder="Optional" />
                    </TableCell>
                    <TableCell className="min-w-[200px]">
                      {line.itemNumber.trim() ? (
                        <LotSelector
                          lots={lots}
                          value={line.lotId}
                          isFtl={isFtl}
                          onChange={(val) => updateLine(index, 'lotId', val)}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">Enter item # first</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => removeLine(index)}>Remove</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={addLine}>Add Item</Button>
          <Button onClick={() => onSubmit(false)} disabled={submitting}>
            {editingOrderId ? 'Update Draft Order' : 'Create Draft Order'}
          </Button>
          <Button variant="secondary" onClick={() => onSubmit(true)} disabled={submitting}>
            {editingOrderId ? 'Update + Send to Processing' : 'Create + Send to Processing'}
          </Button>
          {editingOrderId ? <Button variant="ghost" onClick={onCancel}>Cancel Edit</Button> : null}
          <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            Subtotal <strong>{asMoney(subtotal)}</strong> · Charges <strong>{asMoney(charges.reduce((s, c) => s + asNumber(c.amount), 0))}</strong> ·
            Total <strong>{asMoney(draftTotal)}</strong>
          </div>
        </div>
      </CardContent>

      {browseLineIndex !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/35" onClick={() => { setBrowseLineIndex(null); setBrowseSearch(''); }} />
          <div className="relative z-10 w-full max-w-5xl rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Browse Inventory</h2>
                <p className="text-sm text-muted-foreground">Choose a product for line {browseLineIndex + 1}. Out-of-stock items stay selectable so the order can be built before the truck arrives.</p>
              </div>
              <div className="flex gap-2">
                <Input value={browseSearch} onChange={(e) => setBrowseSearch(e.target.value)} placeholder="Search item #, description, or unit" className="w-72" />
                <Button type="button" variant="ghost" onClick={() => { setBrowseLineIndex(null); setBrowseSearch(''); }}>Close</Button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5">
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>On Hand</TableHead>
                      <TableHead>Default Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Select</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {browsableProducts.length ? browsableProducts.map((product) => {
                      const onHand = asNumber(product.on_hand_qty);
                      const statusLabel = onHand <= 0 ? 'Out of stock' : onHand <= 10 ? 'Low stock' : 'In stock';
                      const statusClassName = onHand <= 0
                        ? 'text-amber-700'
                        : onHand <= 10
                          ? 'text-orange-700'
                          : 'text-emerald-700';
                      return (
                        <TableRow key={productSelectionKey(product)}>
                          <TableCell className="font-mono text-xs">{normalizeText(product.item_number) || '—'}</TableCell>
                          <TableCell className="font-medium">{product.description}</TableCell>
                          <TableCell>{product.unit || '-'}</TableCell>
                          <TableCell>{onHand.toLocaleString()}</TableCell>
                          <TableCell>{asNumber(product.cost) > 0 ? asMoney(asNumber(product.cost)) : '-'}</TableCell>
                          <TableCell className={statusClassName}>{statusLabel}</TableCell>
                          <TableCell className="text-right">
                            <Button type="button" size="sm" onClick={() => applyProductSelection(browseLineIndex, product)}>
                              Use Item
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    }) : (
                      <TableRow>
                        <TableCell colSpan={7} className="text-sm text-muted-foreground">
                          No inventory items matched that search.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function LotSelector({ lots, value, isFtl, onChange }: {
  lots: LotCode[];
  value: string;
  isFtl: boolean;
  onChange: (val: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={['h-10 w-full rounded-md border bg-background px-3 text-sm', isFtl && !value ? 'border-amber-400 ring-1 ring-amber-300' : 'border-input'].join(' ')}
      >
        <option value="">{isFtl ? '— Select lot (required) —' : '— No lot —'}</option>
        {lots.map((lot) => {
          const expLabel = lot.expiration_date ? ` · exp ${fmtDate(lot.expiration_date)}` : '';
          const daysLeft = lot.expiration_date
            ? Math.floor((new Date(lot.expiration_date).getTime() - Date.now()) / 86_400_000)
            : null;
          const urgency  = daysLeft !== null && daysLeft <= 7 ? ' ⚠' : daysLeft !== null && daysLeft <= 30 ? ' ·' : '';
          return (
            <option key={lot.id} value={String(lot.id)}>
              {lot.lot_number}{expLabel}{urgency}
            </option>
          );
        })}
      </select>
      {isFtl && !value && <p className="text-xs text-amber-600">Lot required for FTL product (FSMA 204)</p>}
      {isFtl && lots.length === 0 && <p className="text-xs text-muted-foreground">No active lots on file — receive a PO first</p>}
    </div>
  );
}
