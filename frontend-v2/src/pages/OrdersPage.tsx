import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderStatus = 'pending' | 'in_process' | 'invoiced' | 'cancelled' | 'unknown';

type OrderItem = {
  name?: string;
  description?: string;
  item_number?: string;
  unit?: string;
  requested_qty?: number | string;
  requested_weight?: number | string;
  actual_weight?: number | string;
  quantity?: number | string;
  unit_price?: number | string;
  notes?: string;
  lot_id?: number | string;
  lot_number?: string;
  quantity_from_lot?: number | string;
};

type OrderCharge = {
  key?: string;
  label?: string;
  type?: string;
  value?: number | string;
  amount?: number | string;
};

type Order = {
  id: string;
  customer_id?: string;
  customerId?: string;
  order_number?: string;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  status?: string;
  notes?: string;
  tax_enabled?: boolean;
  tax_rate?: number | string;
  created_at?: string;
  items?: OrderItem[];
  charges?: OrderCharge[];
};

type InventoryProduct = {
  item_number: string;
  description: string;
  is_ftl_product?: boolean;
};

type LotCode = {
  id: number;
  lot_number: string;
  product_id?: string;
  quantity_received?: number;
  unit_of_measure?: string;
  expiration_date?: string | null;
};

type OrderLineDraft = {
  name: string;
  itemNumber: string;
  unit: 'lb' | 'each';
  quantity: string;
  unitPrice: string;
  notes: string;
  lotId: string;       // selected lot_id (string for form state)
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyLine(): OrderLineDraft {
  return { name: '', itemNumber: '', unit: 'lb', quantity: '', unitPrice: '', notes: '', lotId: '' };
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function orderItemQty(item: OrderItem): number {
  if (String(item.unit || '').toLowerCase() === 'lb') {
    return asNumber(item.requested_weight ?? item.actual_weight ?? item.quantity ?? 0);
  }
  return asNumber(item.requested_qty ?? item.quantity ?? item.requested_weight ?? 0);
}

function calcOrderTotal(order: Order): number {
  const itemTotal  = (order.items  || []).reduce((sum, item)   => sum + orderItemQty(item)  * asNumber(item.unit_price), 0);
  const chargeTotal = (order.charges || []).reduce((sum, charge) => sum + asNumber(charge.amount), 0);
  return itemTotal + chargeTotal;
}

function normalizedStatus(value: string | undefined): OrderStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'pending' || status === 'in_process' || status === 'invoiced' || status === 'cancelled') return status;
  return 'unknown';
}

function statusVariant(status: OrderStatus): 'warning' | 'secondary' | 'success' | 'neutral' {
  if (status === 'pending')    return 'warning';
  if (status === 'in_process') return 'secondary';
  if (status === 'invoiced')   return 'success';
  return 'neutral';
}

function draftSubtotal(lines: OrderLineDraft[]): number {
  return lines.reduce((sum, line) => sum + asNumber(line.quantity) * asNumber(line.unitPrice), 0);
}

function orderCustomerId(order: Order): string {
  return String(order.customer_id || order.customerId || '');
}

function fmtDate(value: unknown): string {
  if (!value) return '';
  try { return new Date(String(value)).toLocaleDateString(); } catch { return String(value); }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OrdersPage() {
  const [searchParams] = useSearchParams();
  const customerIdParam = String(searchParams.get('customerId') || '').trim();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [submitting, setSubmitting] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const [customerName, setCustomerName]       = useState('');
  const [customerEmail, setCustomerEmail]     = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [notes, setNotes]                     = useState('');
  const [taxEnabled, setTaxEnabled]           = useState(false);
  const [taxRate, setTaxRate]                 = useState('0.09');
  const [fuelPercent, setFuelPercent]         = useState('');
  const [servicePercent, setServicePercent]   = useState('');
  const [minimumFlat, setMinimumFlat]         = useState('');
  const [lines, setLines]                     = useState<OrderLineDraft[]>([emptyLine()]);

  // FTL lot data: product list + per-product lots cache
  const [products, setProducts]   = useState<InventoryProduct[]>([]);
  const [lotsCache, setLotsCache] = useState<Record<string, LotCode[]>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const query = customerIdParam ? `?customerId=${encodeURIComponent(customerIdParam)}` : '';
      const data = await fetchWithAuth<Order[]>(`/api/orders${query}`);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load orders'));
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts() {
    try {
      const data = await fetchWithAuth<InventoryProduct[]>('/api/inventory');
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      // non-fatal — FTL dropdown just won't show items
    }
  }

  async function loadLotsForProduct(itemNumber: string) {
    if (!itemNumber || lotsCache[itemNumber]) return;
    try {
      const data = await fetchWithAuth<LotCode[]>(`/api/lots?product_id=${encodeURIComponent(itemNumber)}&active_only=true`);
      setLotsCache((prev) => ({ ...prev, [itemNumber]: Array.isArray(data) ? data : [] }));
    } catch {
      setLotsCache((prev) => ({ ...prev, [itemNumber]: [] }));
    }
  }

  useEffect(() => { load(); loadProducts(); }, [customerIdParam]);

  // When item_number changes in a line, pre-fetch lots for that product
  useEffect(() => {
    for (const line of lines) {
      const num = line.itemNumber.trim();
      if (num) loadLotsForProduct(num);
    }
  }, [lines.map((l) => l.itemNumber).join(',')]);

  const ftlSet = useMemo(
    () => new Set(products.filter((p) => p.is_ftl_product).map((p) => p.item_number)),
    [products]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (customerIdParam && orderCustomerId(order) !== customerIdParam) return false;
      const orderStatus = normalizedStatus(order.status);
      if (status !== 'all' && orderStatus !== status) return false;
      if (!needle) return true;
      return (
        String(order.order_number || '').toLowerCase().includes(needle) ||
        String(order.customer_name || '').toLowerCase().includes(needle)
      );
    });
  }, [orders, customerIdParam, search, status]);

  const summary = useMemo(() => {
    const pending    = orders.filter((o) => normalizedStatus(o.status) === 'pending').length;
    const inProcess  = orders.filter((o) => normalizedStatus(o.status) === 'in_process').length;
    const invoiced   = orders.filter((o) => normalizedStatus(o.status) === 'invoiced').length;
    const totalValue = orders.reduce((sum, o) => sum + calcOrderTotal(o), 0);
    return { pending, inProcess, invoiced, totalValue };
  }, [orders]);

  const subtotal = useMemo(() => draftSubtotal(lines), [lines]);
  const charges  = useMemo(() => {
    const fuel    = asNumber(fuelPercent);
    const service = asNumber(servicePercent);
    const minimum = asNumber(minimumFlat);
    const rows: OrderCharge[] = [];
    if (fuel    > 0) rows.push({ key: 'fuel',    label: 'Fuel Surcharge', type: 'percent', value: fuel,    amount: parseFloat(((subtotal * fuel)    / 100).toFixed(2)) });
    if (service > 0) rows.push({ key: 'service', label: 'Service Fee',    type: 'percent', value: service, amount: parseFloat(((subtotal * service)  / 100).toFixed(2)) });
    if (minimum > 0) rows.push({ key: 'minimum', label: 'Minimum Charge', type: 'flat',    value: minimum, amount: parseFloat(minimum.toFixed(2)) });
    return rows;
  }, [subtotal, fuelPercent, servicePercent, minimumFlat]);
  const draftTotal = useMemo(() => subtotal + charges.reduce((sum, c) => sum + asNumber(c.amount), 0), [subtotal, charges]);

  function updateLine(index: number, key: keyof OrderLineDraft, value: string) {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const updated = { ...line, [key]: value };
      // When item_number changes, clear lot selection
      if (key === 'itemNumber') updated.lotId = '';
      return updated;
    }));
  }

  function addLine()  { setLines((c) => [...c, emptyLine()]); }
  function removeLine(index: number) { setLines((c) => (c.length === 1 ? c : c.filter((_, i) => i !== index))); }

  function resetForm() {
    setEditingOrderId(null);
    setCustomerName(''); setCustomerEmail(''); setCustomerAddress('');
    setNotes(''); setTaxEnabled(false); setTaxRate('0.09');
    setFuelPercent(''); setServicePercent(''); setMinimumFlat('');
    setLines([emptyLine()]); setError('');
  }

  function editOrder(order: Order) {
    setEditingOrderId(order.id);
    setCustomerName(order.customer_name || '');
    setCustomerEmail(order.customer_email || '');
    setCustomerAddress(order.customer_address || '');
    setNotes(order.notes || '');
    setTaxEnabled(!!order.tax_enabled);
    setTaxRate(String(order.tax_rate ?? 0.09));

    const existingFuel    = (order.charges || []).find((c) => c.key === 'fuel');
    const existingService = (order.charges || []).find((c) => c.key === 'service');
    const existingMinimum = (order.charges || []).find((c) => c.key === 'minimum');
    setFuelPercent(existingFuel    ? String(existingFuel.value    ?? '') : '');
    setServicePercent(existingService ? String(existingService.value ?? '') : '');
    setMinimumFlat(existingMinimum    ? String(existingMinimum.value  ?? '') : '');

    const draftLines = (order.items || []).map<OrderLineDraft>((item) => ({
      name:       String(item.name || item.description || ''),
      itemNumber: String(item.item_number || ''),
      unit:       String(item.unit || '').toLowerCase() === 'lb' ? 'lb' : 'each',
      quantity:   String(orderItemQty(item) || ''),
      unitPrice:  String(asNumber(item.unit_price) || ''),
      notes:      String(item.notes || ''),
      lotId:      String(item.lot_id || ''),
    }));
    setLines(draftLines.length ? draftLines : [emptyLine()]);
    setNotice(`Editing ${order.order_number || order.id.slice(0, 8)}`);
  }

  function draftPayload() {
    const validLines = lines
      .map((line) => ({
        name:       line.name.trim(),
        item_number: line.itemNumber.trim() || undefined,
        unit:        line.unit,
        quantity:    asNumber(line.quantity),
        unit_price:  asNumber(line.unitPrice),
        notes:       line.notes.trim() || undefined,
        lot_id:      line.lotId ? parseInt(line.lotId, 10) : undefined,
      }))
      .filter((line) => line.name && line.quantity > 0);

    return {
      customerName:    customerName.trim(),
      customerEmail:   customerEmail.trim()   || '',
      customerAddress: customerAddress.trim() || '',
      notes:           notes.trim() || '',
      taxEnabled,
      taxRate: asNumber(taxRate) || 0.09,
      charges,
      items: validLines.map((line) =>
        line.unit === 'lb'
          ? { name: line.name, item_number: line.item_number, unit: 'lb',   requested_weight: line.quantity, quantity: line.quantity, unit_price: line.unit_price, notes: line.notes, lot_id: line.lot_id }
          : { name: line.name, item_number: line.item_number, unit: 'each', requested_qty: line.quantity,    quantity: line.quantity, unit_price: line.unit_price, notes: line.notes, lot_id: line.lot_id }
      ),
    };
  }

  async function submitOrder(sendToProcessing: boolean) {
    const payload = draftPayload();
    if (!payload.customerName) { setError('Customer name is required.'); return; }
    if (!payload.items.length)  { setError('Add at least one order item.'); return; }

    setSubmitting(true); setError(''); setNotice('');
    try {
      let order: Order;
      if (editingOrderId) {
        order = await sendWithAuth<Order>(`/api/orders/${editingOrderId}`, 'PATCH', payload);
      } else {
        order = await sendWithAuth<Order>('/api/orders', 'POST', payload);
      }

      if (sendToProcessing) {
        await sendWithAuth(`/api/orders/${order.id}/send`, 'POST', { taxEnabled: payload.taxEnabled, taxRate: payload.taxRate });
      }

      setNotice(
        editingOrderId
          ? sendToProcessing ? 'Order updated and sent to processing.' : 'Order updated.'
          : sendToProcessing ? 'Order created and sent to processing.' : 'Order created.'
      );
      resetForm();
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not save order'));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm('Delete this order?')) return;
    try {
      await sendWithAuth(`/api/orders/${id}`, 'DELETE');
      setNotice('Order deleted.');
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete order'));
    }
  }

  async function sendOrder(order: Order) {
    try {
      await sendWithAuth(`/api/orders/${order.id}/send`, 'POST', { taxEnabled: !!order.tax_enabled, taxRate: asNumber(order.tax_rate) || 0.09 });
      setNotice(`Order ${order.order_number || order.id.slice(0, 8)} sent to processing.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not send order to processing'));
    }
  }

  async function quickFulfill(order: Order) {
    if (!confirm(`Quick fulfill ${order.order_number || order.id.slice(0, 8)} and generate invoice?`)) return;
    try {
      await sendWithAuth(`/api/orders/${order.id}/fulfill`, 'POST', { items: order.items || [], driverName: null, routeId: null });
      setNotice(`Order ${order.order_number || order.id.slice(0, 8)} fulfilled.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not fulfill order'));
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading orders...</div> : null}
      {error   ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice  ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}
      {customerIdParam ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Filtered by customer from Customers page: <strong>{customerIdParam}</strong>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Orders"              value={orders.length.toLocaleString()} />
        <SummaryCard title="Pending"             value={summary.pending.toLocaleString()} />
        <SummaryCard title="In Process"          value={summary.inProcess.toLocaleString()} />
        <SummaryCard title="Total Pipeline Value" value={asMoney(summary.totalValue)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editingOrderId ? 'Edit Order' : 'Create Order'}</CardTitle>
          <CardDescription>
            FTL-flagged products require a lot assignment (FSMA 204). Select the soonest-to-expire lot first (FEFO).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Customer Name</span>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Oceanview Market" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Customer Email</span>
              <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="buyer@customer.com" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Customer Address</span>
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="123 Harbor St" />
            </label>
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

          <div className="rounded-lg border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Item #</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit Price</TableHead>
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
                  const isFtl  = ftlSet.has(line.itemNumber.trim());
                  const lots   = lotsCache[line.itemNumber.trim()] || [];
                  const needsLot = isFtl && !line.lotId;
                  return (
                    <TableRow key={index} className={needsLot ? 'bg-amber-50/50' : ''}>
                      <TableCell>
                        <Input value={line.name} onChange={(e) => updateLine(index, 'name', e.target.value)} placeholder="Atlantic Salmon" />
                      </TableCell>
                      <TableCell>
                        <Input value={line.itemNumber} onChange={(e) => updateLine(index, 'itemNumber', e.target.value)} placeholder="SAL-01" />
                      </TableCell>
                      <TableCell>
                        <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={line.unit} onChange={(e) => updateLine(index, 'unit', e.target.value as 'lb' | 'each')}>
                          <option value="lb">lb</option>
                          <option value="each">each</option>
                        </select>
                      </TableCell>
                      <TableCell>
                        <Input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', e.target.value)} />
                      </TableCell>
                      <TableCell>{asMoney(asNumber(line.quantity) * asNumber(line.unitPrice))}</TableCell>
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
            <Button onClick={() => submitOrder(false)} disabled={submitting}>
              {editingOrderId ? 'Update Order' : 'Create Order'}
            </Button>
            <Button variant="secondary" onClick={() => submitOrder(true)} disabled={submitting}>
              {editingOrderId ? 'Update + Send' : 'Create + Send'}
            </Button>
            {editingOrderId ? <Button variant="ghost" onClick={resetForm}>Cancel Edit</Button> : null}
            <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              Subtotal <strong>{asMoney(subtotal)}</strong> · Charges <strong>{asMoney(charges.reduce((s, c) => s + asNumber(c.amount), 0))}</strong> ·
              Total <strong>{asMoney(draftTotal)}</strong>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Orders Workbench</CardTitle>
            <CardDescription>Includes edit, send-to-processing, quick fulfill, and delete actions.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order # or customer" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | 'all')}
                className="flex h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="in_process">In Process</option>
                <option value="invoiced">Invoiced</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? (
                  filtered.map((order) => {
                    const parsedStatus = normalizedStatus(order.status);
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                        <TableCell>{order.customer_name || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(parsedStatus)}>{String(order.status || 'unknown').replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell>{(order.items || []).length.toLocaleString()}</TableCell>
                        <TableCell>{asMoney(calcOrderTotal(order))}</TableCell>
                        <TableCell>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button variant="ghost" size="sm" onClick={() => editOrder(order)}>Edit</Button>
                            {parsedStatus === 'pending' ? (
                              <Button variant="secondary" size="sm" onClick={() => sendOrder(order)}>Send</Button>
                            ) : null}
                            {parsedStatus === 'in_process' ? (
                              <Button variant="secondary" size="sm" onClick={() => quickFulfill(order)}>Fulfill</Button>
                            ) : null}
                            <Button variant="ghost" size="sm" onClick={() => deleteOrder(order.id)}>Delete</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">No orders match the current filters.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── LotSelector ───────────────────────────────────────────────────────────────
// FEFO-sorted dropdown. Lots are already sorted by expiration_date ASC from the API.

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
        className={[
          'h-10 w-full rounded-md border bg-background px-3 text-sm',
          isFtl && !value ? 'border-amber-400 ring-1 ring-amber-300' : 'border-input',
        ].join(' ')}
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
      {isFtl && !value && (
        <p className="text-xs text-amber-600">Lot required for FTL product (FSMA 204)</p>
      )}
      {isFtl && lots.length === 0 && (
        <p className="text-xs text-muted-foreground">No active lots on file — receive a PO first</p>
      )}
    </div>
  );
}

// ── Small sub-components ──────────────────────────────────────────────────────

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
