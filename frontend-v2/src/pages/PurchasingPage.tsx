import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type PurchaseOrder = {
  id: string;
  po_number?: string;
  vendor?: string;
  total_cost?: number | string;
  confirmed_by?: string;
  created_at?: string;
  items?: unknown[];
};

type PurchaseItemDraft = {
  description: string;
  quantity: string;
  unit_price: string;
  unit: string;
  category: string;
};

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const emptyLine = (): PurchaseItemDraft => ({
  description: '',
  quantity: '',
  unit_price: '',
  unit: 'lb',
  category: 'Other',
});

export function PurchasingPage() {
  const [searchParams] = useSearchParams();
  const vendorParam = String(searchParams.get('vendor') || '').trim();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [vendor, setVendor] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseItemDraft[]>([emptyLine()]);
  const [vendorFilter, setVendorFilter] = useState<'all' | string>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const query = vendorParam ? `?vendor=${encodeURIComponent(vendorParam)}` : '';
      const data = await fetchWithAuth<PurchaseOrder[]>(`/api/purchase-orders${query}`);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load purchase orders'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [vendorParam]);

  useEffect(() => {
    setVendorFilter(vendorParam || 'all');
  }, [vendorParam]);

  const summary = useMemo(() => {
    return {
      count: orders.length,
      spend: orders.reduce((sum, order) => sum + asNumber(order.total_cost), 0),
      vendors: new Set(orders.map((order) => String(order.vendor || '').trim()).filter(Boolean)).size,
    };
  }, [orders]);

  const draftTotal = useMemo(
    () => lines.reduce((sum, line) => sum + asNumber(line.quantity) * asNumber(line.unit_price), 0),
    [lines]
  );

  const vendorOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const order of orders) {
      const name = String(order.vendor || '').trim();
      if (name) unique.add(name);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (vendorFilter === 'all') return orders;
    return orders.filter((order) => String(order.vendor || '').trim() === vendorFilter);
  }, [orders, vendorFilter]);

  function updateLine(index: number, key: keyof PurchaseItemDraft, value: string) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
  }

  async function submitPurchaseOrder() {
    const items = lines
      .map((line) => ({
        description: line.description.trim(),
        quantity: asNumber(line.quantity),
        unit_price: asNumber(line.unit_price),
        unit: line.unit.trim() || 'lb',
        category: line.category.trim() || 'Other',
      }))
      .filter((item) => item.description && item.quantity > 0);

    if (!items.length) {
      setError('Add at least one line with description and quantity.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const total_cost = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
      const response = await sendWithAuth<{ errors?: string[] }>(
        '/api/purchase-orders/confirm',
        'POST',
        {
          vendor: vendor || null,
          po_number: poNumber || null,
          notes: notes || null,
          total_cost,
          items: items.map((item) => ({
            ...item,
            total: parseFloat((item.quantity * item.unit_price).toFixed(2)),
          })),
        }
      );
      const failed = Array.isArray(response.errors) && response.errors.length;
      setNotice(
        failed
          ? `PO saved with ${response.errors?.length || 0} line errors. Review backend validation details if needed.`
          : 'Purchase order confirmed and inventory updated.'
      );
      setVendor('');
      setPoNumber('');
      setNotes('');
      setLines([emptyLine()]);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Failed to confirm purchase order'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading purchasing data...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}
      {vendorParam ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Filtered by vendor from Vendors page: <strong>{vendorParam}</strong>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Purchase Orders" value={summary.count.toLocaleString()} />
        <StatCard label="Total Spend" value={money(summary.spend)} />
        <StatCard label="Active Vendors" value={summary.vendors.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Confirm Purchase Order</CardTitle>
          <CardDescription>Manual ingest flow using `/api/purchase-orders/confirm` for migration parity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Vendor</span>
              <Input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Blue Ocean Seafood" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">PO Number</span>
              <Input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} placeholder="PO-2026-044" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Notes</span>
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Dock B receiving" />
            </label>
          </div>

          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input value={line.description} onChange={(event) => updateLine(index, 'description', event.target.value)} placeholder="Atlantic Salmon" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => updateLine(index, 'unit_price', event.target.value)} />
                    </TableCell>
                    <TableCell>
                      <Input value={line.unit} onChange={(event) => updateLine(index, 'unit', event.target.value)} />
                    </TableCell>
                    <TableCell>
                      <Input value={line.category} onChange={(event) => updateLine(index, 'category', event.target.value)} />
                    </TableCell>
                    <TableCell>{money(asNumber(line.quantity) * asNumber(line.unit_price))}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => removeLine(index)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={addLine}>
              Add Line
            </Button>
            <Button onClick={submitPurchaseOrder} disabled={submitting}>
              Confirm PO
            </Button>
            <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              Draft Total: <strong>{money(draftTotal)}</strong>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Purchasing Orders</CardTitle>
            <CardDescription>Historical purchase orders from existing backend APIs.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vendor</span>
              <select
                value={vendorFilter}
                onChange={(event) => setVendorFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Vendors</option>
                {vendorOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Total Cost</TableHead>
                <TableHead>Line Items</TableHead>
                <TableHead>Confirmed By</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length ? (
                filteredOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.po_number || order.id.slice(0, 8)}</TableCell>
                    <TableCell>{order.vendor || <Badge variant="neutral">Unspecified</Badge>}</TableCell>
                    <TableCell>{money(asNumber(order.total_cost))}</TableCell>
                    <TableCell>{(order.items || []).length.toLocaleString()}</TableCell>
                    <TableCell>{order.confirmed_by || '-'}</TableCell>
                    <TableCell>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No purchase orders found for the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
