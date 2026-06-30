import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  type PurchaseOrder,
  type VendorPurchaseOrder,
  openPurchaseOrderPdf,
  usePurchaseOrders,
  useVendorPurchaseOrders,
} from '../hooks/usePurchasing';
import { type Vendor, useVendorsQuery } from '../hooks/useVendors';
import { VendorPerformanceCard } from './VendorPerformanceCard';
import { PurchasingReceivingInsights } from './PurchasingReceivingInsights';
import { ReceivePoDrawer } from './ReceivePoDrawer';
import { CreatePurchaseOrderForm } from './CreatePurchaseOrderForm';
import {
  type LeadTimeInsights,
  type ReceiptDiscrepancyEntry,
  asNumber,
  buildVendorOptions,
  formatLeadTimeDays,
  money,
  statusTone,
} from './purchasing.helpers';

export function PurchasingPage() {
  const [searchParams] = useSearchParams();
  const vendorParam   = String(searchParams.get('vendor') || '').trim();
  const itemParam     = String(searchParams.get('item') || '').trim();
  const qtyParam      = String(searchParams.get('qty') || '').trim();

  const { data: orders = [], isLoading, isError, error, refetch } = usePurchaseOrders(vendorParam || undefined);
  const { data: vendorPurchaseOrders = [], isLoading: vendorPoLoading, isError: vendorPoError, error: vendorPoErrorValue, refetch: refetchVendorPos } = useVendorPurchaseOrders();
  const { data: vendorRecords = [] } = useVendorsQuery();

  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [vendorFilter, setVendorFilter] = useState<'all' | string>(vendorParam || 'all');
  const [activeReceivePo, setActiveReceivePo] = useState<VendorPurchaseOrder | null>(null);
  const [activeDraft, setActiveDraft] = useState<PurchaseOrder | null>(null);

  const planningVendor = useMemo(() => {
    const selectedVendorName = vendorParam || (vendorFilter === 'all' ? '' : vendorFilter);
    if (!selectedVendorName) return null;
    return vendorRecords.find((vendor) =>
      String(vendor.name || '').trim().toLowerCase() === selectedVendorName.trim().toLowerCase()
    ) || null;
  }, [vendorFilter, vendorParam, vendorRecords]);

  const summary = useMemo(() => ({
    count: orders.length,
    spend: orders.reduce((sum, o) => sum + asNumber(o.total_cost), 0),
    vendors: new Set(orders.map((o) => String(o.vendor || '').trim()).filter(Boolean)).size,
  }), [orders]);

  const vendorOptions = useMemo(() => buildVendorOptions(orders, vendorRecords), [orders, vendorRecords]);

  const filteredOrders = useMemo(() =>
    vendorFilter === 'all' ? orders : orders.filter((o) => String(o.vendor || '').trim() === vendorFilter),
    [orders, vendorFilter],
  );

  const openVendorPurchaseOrders = useMemo(
    () =>
      vendorPurchaseOrders.filter((po) => {
        const status = String(po.status || '').trim().toLowerCase();
        return status !== 'received' && status !== 'cancelled';
      }),
    [vendorPurchaseOrders],
  );

  const discrepancyLog = useMemo(() => {
    const entries: ReceiptDiscrepancyEntry[] = [];
    let receiptsWithVariance = 0;
    let shortQty = 0;
    let overQty = 0;

    for (const po of vendorPurchaseOrders) {
      for (const receipt of po.receipts || []) {
        const lines = (receipt.lines || []).filter((line) => {
          const varianceType = String(line.variance_type || '').trim().toLowerCase();
          return varianceType && varianceType !== 'exact_receipt'
            || asNumber(line.over_receipt_qty) > 0
            || asNumber(line.quantity_variance_qty) !== 0;
        });
        if (!lines.length) continue;
        receiptsWithVariance += 1;
        for (const line of lines) {
          const quantityVariance = asNumber(line.quantity_variance_qty);
          const overReceiptQty = asNumber(line.over_receipt_qty);
          if (quantityVariance < 0) shortQty += Math.abs(quantityVariance);
          if (overReceiptQty > 0) overQty += overReceiptQty;
          entries.push({
            id: `${po.id}:${receipt.id}:${line.line_no}`,
            poNumber: po.po_number || po.id.slice(0, 8),
            vendor: String(po.vendor || po.vendor_name || 'Unassigned Vendor'),
            receivedAt: receipt.received_at || '',
            lineLabel: line.product_name || line.item_number || `Line ${line.line_no}`,
            varianceLabel: String(line.variance_type || 'variance').replace(/_/g, ' '),
            quantityVariance,
            overReceiptQty,
          });
        }
      }
    }

    entries.sort((left, right) => String(right.receivedAt || '').localeCompare(String(left.receivedAt || '')));
    return {
      entries,
      receiptsWithVariance,
      shortQty,
      overQty,
    };
  }, [vendorPurchaseOrders]);

  const leadTimeInsights = useMemo<LeadTimeInsights>(() => {
    const measured = vendorPurchaseOrders
      .map((po) => asNumber(po.first_receipt_lead_time_days))
      .filter((value) => value > 0);
    const sorted = [...measured].sort((left, right) => left - right);
    const medianValue = sorted.length
      ? (sorted.length % 2 === 0
        ? (sorted[(sorted.length / 2) - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)])
      : 0;
    const latestMeasured = [...vendorPurchaseOrders]
      .filter((po) => asNumber(po.first_receipt_lead_time_days) > 0 && po.first_received_at)
      .sort((left, right) => String(right.first_received_at || '').localeCompare(String(left.first_received_at || '')))[0];

    return {
      measuredCount: measured.length,
      vendorCount: new Set(vendorPurchaseOrders.map((po) => String(po.vendor || po.vendor_name || '').trim()).filter(Boolean)).size,
      averageDays: measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : 0,
      medianDays: measured.length ? medianValue : 0,
      latestDays: latestMeasured ? asNumber(latestMeasured.first_receipt_lead_time_days) : null,
    };
  }, [vendorPurchaseOrders]);

  function printPurchaseOrder(order: PurchaseOrder) {
    const popup = openPurchaseOrderPdf(order.id);
    if (!popup) {
      setFormError('The browser blocked the PO PDF preview. Allow popups for NodeRoute and try again.');
      return;
    }
  }

  return (
    <div className="space-y-5">
      {isLoading || vendorPoLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading purchasing data...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load purchase orders')}</div> : null}
      {vendorPoError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((vendorPoErrorValue as Error)?.message || 'Could not load vendor PO receiving data')}</div> : null}
      {formError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{formError}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}
      {vendorParam ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Filtered by vendor from Vendors page: <strong>{vendorParam}</strong>
        </div>
      ) : null}
      {itemParam ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          New PO pre-filled for low-stock item: <strong>{itemParam}</strong>
          {qtyParam ? ` · Suggested qty: ${qtyParam}` : ''}
          {' '}— Review and adjust below, then save for later or confirm.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Purchase Orders" value={summary.count.toLocaleString()} />
        <StatCard label="Total Spend" value={money(summary.spend)} />
        <StatCard label="Active Vendors" value={summary.vendors.toLocaleString()} />
      </div>

      {/* ── Vendor Performance Scorecard ── */}
      <VendorPerformanceCard />

      {planningVendor ? (
        <Card>
          <CardHeader>
            <CardTitle>Vendor Planning Rules</CardTitle>
            <CardDescription>{planningVendor.name || 'Selected vendor'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <PlanningMetric label="Minimum Order" value={asNumber(planningVendor.min_order_value) > 0 ? money(asNumber(planningVendor.min_order_value)) : 'None'} />
              <PlanningMetric label="Pallet Qty" value={planningQuantityLabel(planningVendor.pallet_qty)} />
              <PlanningMetric label="Layer Qty" value={planningQuantityLabel(planningVendor.layer_qty)} />
              <PlanningMetric label="Lead Time" value={asNumber(planningVendor.lead_time_days) > 0 ? `${asNumber(planningVendor.lead_time_days)} days` : 'Default'} />
              <PlanningMetric label="Seasonal Windows" value={`${seasonalWindowCount(planningVendor)} active`} />
            </div>
            {!vendorHasPlanningConfig(planningVendor) ? (
              <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                This vendor is using the default reorder calculation.
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <CreatePurchaseOrderForm
        setNotice={setNotice}
        setFormError={setFormError}
        editingDraft={activeDraft}
        onDraftChange={setActiveDraft}
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Receive Vendor Purchase Orders</CardTitle>
            <CardDescription>Pull up any open PO, compare ordered vs. received quantities, and post receipts directly into inventory with variance tracking.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{openVendorPurchaseOrders.length} open / partial</Badge>
            <Button variant="outline" onClick={() => refetchVendorPos()}>Refresh Receiving Queue</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lead Time</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Backordered</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openVendorPurchaseOrders.length ? openVendorPurchaseOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.po_number || po.id.slice(0, 8)}</TableCell>
                    <TableCell>{po.vendor || po.vendor_name || '-'}</TableCell>
                    <TableCell><Badge variant={statusTone(po.status)}>{String(po.status || 'open').replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {Number.isFinite(Number(po.first_receipt_lead_time_days)) && asNumber(po.first_receipt_lead_time_days) > 0 ? (
                          <span>{formatLeadTimeDays(po.first_receipt_lead_time_days)} actual</span>
                        ) : Number.isFinite(Number(po.lead_time_history?.average_days)) && asNumber(po.lead_time_history?.average_days) > 0 ? (
                          <span>{formatLeadTimeDays(po.lead_time_history?.average_days)} avg</span>
                        ) : (
                          <span className="text-muted-foreground">Pending first receipt</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{asNumber(po.total_ordered_qty).toFixed(2)}</TableCell>
                    <TableCell>{asNumber(po.total_received_qty).toFixed(2)}</TableCell>
                    <TableCell>{asNumber(po.total_backordered_qty).toFixed(2)}</TableCell>
                    <TableCell>{po.created_at ? new Date(po.created_at).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => setActiveReceivePo(po)}>
                        {activeReceivePo?.id === po.id ? 'Receiving Open' : 'Receive Items'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-muted-foreground">
                      No open vendor purchase orders are waiting on receipts right now.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <PurchasingReceivingInsights leadTimeInsights={leadTimeInsights} discrepancyLog={discrepancyLog} />

          {activeReceivePo ? (
            <ReceivePoDrawer
              key={activeReceivePo.id}
              po={activeReceivePo}
              onPosted={setActiveReceivePo}
              onClose={() => setActiveReceivePo(null)}
              setNotice={setNotice}
              setFormError={setFormError}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
              Select an open vendor PO above to compare ordered vs. received quantities and post the receipt into inventory.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historical POs */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Purchasing Orders</CardTitle>
            <CardDescription>Historical purchase orders.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vendor</span>
              <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All Vendors</option>
                {vendorOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </label>
            <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total Cost</TableHead>
                <TableHead>Line Items</TableHead>
                <TableHead>Confirmed By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length ? filteredOrders.map((order: PurchaseOrder) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.po_number || order.id.slice(0, 8)}</TableCell>
                  <TableCell>{order.vendor || <Badge variant="neutral">Unspecified</Badge>}</TableCell>
                  <TableCell><Badge variant={statusTone(order.status)}>{String(order.status || 'received').replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell>{money(asNumber(order.total_cost))}</TableCell>
                  <TableCell>{(order.items || []).length.toLocaleString()}</TableCell>
                  <TableCell>{order.confirmed_by || '-'}</TableCell>
                  <TableCell>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-right">
                    {String(order.status || '').trim().toLowerCase() === 'draft' ? (
                      <Button variant="secondary" size="sm" onClick={() => { setActiveDraft(order); setFormError(''); setNotice(`Loaded draft ${order.po_number || order.id.slice(0, 8)} for editing.`); }}>
                        Resume Draft
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => printPurchaseOrder(order)}>
                        Open PDF
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground">No purchase orders found for the selected filters.</TableCell></TableRow>
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
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>
  );
}

function PlanningMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function planningQuantityLabel(value: unknown): string {
  const parsed = asNumber(value);
  return parsed > 0 ? parsed.toLocaleString() : 'None';
}

function seasonalWindowCount(vendor: Vendor): number {
  const windows = vendor.seasonal_usage_windows;
  if (Array.isArray(windows)) return windows.length;
  if (typeof windows === 'string' && windows.trim()) {
    try {
      const parsed = JSON.parse(windows);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function vendorHasPlanningConfig(vendor: Vendor): boolean {
  return asNumber(vendor.min_order_value) > 0
    || asNumber(vendor.pallet_qty) > 0
    || asNumber(vendor.layer_qty) > 0
    || asNumber(vendor.lead_time_days) > 0
    || seasonalWindowCount(vendor) > 0;
}
