import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { getUserRole, sendWithAuth } from '../lib/api';
import { useOrderForm } from '../hooks/useOrderForm';
import {
  orderKeys,
  useCustomersQuery,
  useDeleteOrderMutation,
  useFulfillOrderMutation,
  useInventoryQuery,
  useLotsCache,
  useOrdersQuery,
  useSaveWeightMutation,
  useSendOrderMutation,
  useSubmitOrderMutation,
} from '../hooks/useOrders';
import { OrderWeightsBoard } from './OrderWeightsBoard';
import { OrderFormCard } from './OrderFormCard';
import { OrdersWorkbench } from './OrdersWorkbench';
import { WeightCaptureCard } from './WeightCaptureCard';
import { WeightStationPanel } from './WeightStationPanel';
import {
  asMoney,
  asNumber,
  calcOrderTotal,
  normalizedStatus,
  normalizeText,
  orderHasCapturedWeights,
  orderHasPendingWeights,
  orderItemQty,
  productSelectionKey,
} from './orders.types';
import type { Order, OrderStatus } from './orders.types';
import { usePricingAnomalies } from '../hooks/useAI';
import { SmsDraftsPanel } from './SmsDraftsPanel';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openPrintWindow(): Window | null {
  const popup = window.open('', '_blank', 'width=960,height=720');
  if (popup) {
    popup.document.write('<!DOCTYPE html><html><head><title>Preparing order...</title></head><body style="font-family:Arial,sans-serif;padding:24px">Preparing order for print...</body></html>');
    popup.document.close();
  }
  return popup;
}

function printOrderSlip(order: Order, popup: Window | null) {
  if (!popup) return;
  const rows = (order.items || []).map((item) => {
    const qty = orderItemQty(item);
    const unit = item.is_catch_weight ? 'lb' : String(item.unit || '').toLowerCase() === 'lb' ? 'lb' : 'ea';
    const price = item.is_catch_weight ? asNumber(item.price_per_lb) : asNumber(item.unit_price);
    return `<tr>
      <td>${escapeHtml(item.name || item.description || item.item_number || '—')}</td>
      <td>${escapeHtml(item.notes || '')}</td>
      <td>${escapeHtml(qty.toFixed(unit === 'lb' ? 2 : 0))} ${unit}</td>
      <td>$${price.toFixed(2)}</td>
    </tr>`;
  }).join('');
  const orderNumber = order.order_number || order.id.slice(0, 8);
  popup.document.open();
  popup.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Order ${escapeHtml(orderNumber)}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin-bottom:4px}
    .muted{color:#666;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th{background:#f5f5f5;padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;color:#666}
    td{padding:8px 12px;border-bottom:1px solid #e6e6e6;vertical-align:top}
    .print-actions{display:flex;justify-content:flex-end;margin-bottom:16px}
    .print-btn{background:#3dba7f;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px}
    @media print {.print-actions{display:none} body{padding:0.4in}}
  </style>
</head>
<body>
  <div class="print-actions"><button class="print-btn" onclick="window.print()">Print</button></div>
  <h1>Order ${escapeHtml(orderNumber)}</h1>
  <div class="muted">${escapeHtml(order.customer_name || 'No customer')} · ${escapeHtml(order.customer_address || '')}</div>
  <div class="muted" style="font-size:12px;margin-top:2px">${escapeHtml(new Date().toLocaleString())}</div>
  <table>
    <thead><tr><th>Item</th><th>Notes</th><th>Quantity</th><th>Price</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center">No line items</td></tr>'}</tbody>
  </table>
</body>
</html>`);
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 300);
}

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const customerIdParam = String(searchParams.get('customerId') || '').trim();
  const orderIdParam    = String(searchParams.get('orderId')    || '').trim();

  // ── Queries ──────────────────────────────────────────────────────────────
  const ordersQuery    = useOrdersQuery(customerIdParam);
  const customersQuery = useCustomersQuery();
  const productsQuery  = useInventoryQuery();
  const { lotsCache, loadLotsForProduct } = useLotsCache();
  const queryClient = useQueryClient();

  const orders    = ordersQuery.data    ?? [];
  const customers = customersQuery.data ?? [];
  const products  = (productsQuery.data ?? []).filter((p) => p.is_active !== false);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const submitOrderMutation  = useSubmitOrderMutation();
  const sendOrderMutation    = useSendOrderMutation();
  const deleteOrderMutation  = useDeleteOrderMutation();
  const fulfillOrderMutation = useFulfillOrderMutation();
  const saveWeightMutation   = useSaveWeightMutation();

  const form = useOrderForm({ products, lotsCache });

  const [notice, setNotice]   = useState('');
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState<OrderStatus | 'all'>('all');
  const [submitting, setSubmitting] = useState(false);
  const [weightCaptureOrder, setWeightCaptureOrder] = useState<Order | null>(null);
  const [weightInputs, setWeightInputs]             = useState<Record<string, string>>({});
  const [showWeightStation, setShowWeightStation]   = useState(false);
  const [savingWeight, setSavingWeight]             = useState<Record<string, boolean>>({});
  const openedOrderIdRef = useRef<string | null>(null);
  const dashboardAction = String(searchParams.get('action') || '').trim().toLowerCase();
  const weightBoardFilter: 'needs' | 'captured' | null =
    !orderIdParam && dashboardAction === 'weights-entered'
      ? 'captured'
      : !orderIdParam && dashboardAction === 'weights'
        ? 'needs'
        : null;

  const role = getUserRole();

  // ── Pricing Anomaly Detection ────────────────────────────────────────
  const pricingAnomalies = usePricingAnomalies();
  const [anomalyDays, setAnomalyDays] = useState(30);

  // ── Order Intake (AI parse) ──────────────────────────────────────────────
  const [intakeOpen, setIntakeOpen]       = useState(false);
  const [intakeText, setIntakeText]       = useState('');
  const [intakeParsing, setIntakeParsing] = useState(false);
  const [intakeError, setIntakeError]     = useState('');

  async function runOrderIntake() {
    if (!intakeText.trim()) return;
    setIntakeParsing(true);
    setIntakeError('');
    try {
      type IntakeResult = {
        customer_name_hint?: string | null;
        order_notes?: string | null;
        warnings?: string[];
        items: { name: string; unit: string; amount: number; unit_price: number; notes?: string | null; item_number?: string | null }[];
      };
      const result = await sendWithAuth<IntakeResult>('/api/ai/order-intake', 'POST', { message: intakeText });
      if (result.customer_name_hint) form.setCustomerName(result.customer_name_hint);
      if (result.order_notes) form.setNotes(result.order_notes);
      type ParsedLine = { itemNumber: string; description: string; quantity: string; unit: string; unitPrice: string; notes: string };
      const matchedLines: ParsedLine[] = (result.items || []).map((item) => {
        const matched = products.find((p) =>
          p.description?.toLowerCase().includes(item.name.toLowerCase()) ||
          (item.item_number && normalizeText(p.item_number) === normalizeText(item.item_number))
        );
        return {
          itemNumber: matched?.item_number || item.item_number || '',
          description: matched?.description || item.name,
          quantity: String(item.amount),
          unit: item.unit,
          unitPrice: item.unit_price > 0 ? String(item.unit_price) : (matched ? String(matched.cost || '') : ''),
          notes: item.notes || '',
        };
      });

      function applyLine(idx: number, line: ParsedLine) {
        const matched = products.find((product) =>
          normalizeText(product.item_number) === normalizeText(line.itemNumber)
          || product.description?.toLowerCase() === line.description.toLowerCase()
        );
        if (matched) {
          form.updateLine(idx, 'productId', productSelectionKey(matched));
        } else if (line.itemNumber) {
          form.updateLine(idx, 'itemNumber', line.itemNumber);
        }
        form.updateLine(idx, 'quantity', line.quantity);
        const safeUnit = line.unit === 'lb' || line.unit === 'each' ? line.unit : 'each';
        form.updateLine(idx, 'unit', safeUnit);
        if (line.unitPrice) form.updateLine(idx, 'unitPrice', line.unitPrice);
        if (line.notes) form.updateLine(idx, 'notes', line.notes);
      }

      if (matchedLines.length) {
        applyLine(0, matchedLines[0]);
        for (let i = 1; i < matchedLines.length; i++) {
          form.addLine();
        }
        setTimeout(() => {
          for (let i = 1; i < matchedLines.length; i++) applyLine(i, matchedLines[i]);
        }, 50);
      }
      setIntakeOpen(false);
      setIntakeText('');
      setNotice(`Parsed ${matchedLines.length} item(s) from message.${result.warnings?.length ? ' Warnings: ' + result.warnings.join('; ') : ''}`);
    } catch (err) {
      setIntakeError(String((err as Error).message || 'Parse failed'));
    } finally {
      setIntakeParsing(false);
    }
  }

  useEffect(() => {
    for (const line of form.lines) {
      const num = line.itemNumber.trim();
      if (num) void loadLotsForProduct(num);
    }
  }, [form.lines.map((l) => l.itemNumber).join(',')]);

  useEffect(() => {
    if (!orderIdParam || !orders.length || openedOrderIdRef.current === orderIdParam) return;
    const order = orders.find((item) => item.id === orderIdParam);
    if (!order) return;

    const requestedAction = String(searchParams.get('action') || '').trim().toLowerCase();
    if (requestedAction === 'weights' && orderIdParam) {
      setWeightCaptureOrder(order);
      setNotice(`Opened weights for ${order.order_number || order.id.slice(0, 8)}.`);
    } else {
      handleEditOrder(order);
    }

    openedOrderIdRef.current = orderIdParam;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('orderId');
    nextParams.delete('action');
    setSearchParams(nextParams, { replace: true });
  }, [orderIdParam, orders, searchParams, setSearchParams]);

  const summary = useMemo(() => ({
    pending:    orders.filter((o) => normalizedStatus(o.status) === 'pending').length,
    inProcess:  orders.filter((o) => normalizedStatus(o.status) === 'in_process').length,
    invoiced:   orders.filter((o) => normalizedStatus(o.status) === 'invoiced').length,
    totalValue: orders.reduce((sum, o) => sum + calcOrderTotal(o), 0),
  }), [orders]);

  async function submitOrder(sendToProcessing: boolean) {
    const payload = form.buildPayload();
    if (!payload.customerName) { setError('Customer name is required.'); return; }
    if (!payload.items.length) { setError('Add at least one order item.'); return; }

    setSubmitting(true); setError(''); setNotice('');
    try {
      const order = await submitOrderMutation.mutateAsync({ editingOrderId: form.editingOrderId, payload });
      let printableOrder = order;
      if (sendToProcessing) {
        const printPopup = openPrintWindow();
        const sentOrder = await sendOrderMutation.mutateAsync({
          orderId: order.id,
          taxEnabled: payload.taxEnabled,
          taxRate: payload.taxRate,
        });
        printableOrder = { ...order, ...sentOrder, items: sentOrder.items || order.items };
        printOrderSlip(printableOrder, printPopup);
      }
      setNotice(
        form.editingOrderId
          ? sendToProcessing ? 'Order updated and sent to processing.' : 'Order updated.'
          : sendToProcessing ? 'Order created and sent to processing.' : 'Order created.',
      );
      form.reset();
    } catch (err) {
      setError(String((err as Error).message || 'Could not save order'));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm('Delete this order?')) return;
    try {
      await deleteOrderMutation.mutateAsync(id);
      setNotice('Order deleted.');
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete order'));
    }
  }

  async function sendOrder(order: Order) {
    const printPopup = openPrintWindow();
    try {
      const sentOrder = await sendOrderMutation.mutateAsync({
        orderId: order.id,
        taxEnabled: !!order.tax_enabled,
        taxRate: asNumber(order.tax_rate) || 0.09,
      });
      printOrderSlip({ ...order, ...sentOrder, items: sentOrder.items || order.items }, printPopup);
      setNotice(`Order ${order.order_number || order.id.slice(0, 8)} sent to processing.`);
    } catch (err) {
      printPopup?.close();
      setError(String((err as Error).message || 'Could not send order to processing'));
    }
  }

  async function markOrderDelivered(order: Order) {
    const orderLabel = order.order_number || order.id.slice(0, 8);
    if (!confirm(`Mark ${orderLabel} as delivered?`)) return;
    try {
      const result = await sendWithAuth<Order & { emailSent?: boolean; emailError?: string | null }>(
        `/api/orders/${order.id}`,
        'PATCH',
        { status: 'delivered' }
      );
      await queryClient.invalidateQueries({ queryKey: orderKeys.all });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (result.emailSent) {
        setNotice(`Order ${orderLabel} marked as delivered and invoice emailed.`);
      } else if (result.emailError) {
        setNotice(`Order ${orderLabel} marked as delivered. Invoice email skipped: ${result.emailError}`);
      } else {
        setNotice(`Order ${orderLabel} marked as delivered.`);
      }
    } catch (err) {
      setError(String((err as Error).message || 'Could not mark order as delivered'));
    }
  }

  async function resendInvoiceEmail(order: Order) {
    const invoiceId = order.invoice_id || order.invoiceId;
    const orderLabel = order.order_number || order.id.slice(0, 8);
    if (!invoiceId) {
      setError(`Order ${orderLabel} does not have a linked invoice yet.`);
      return;
    }
    try {
      await sendWithAuth(`/api/invoices/${invoiceId}/resend`, 'POST');
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setNotice(`Invoice email resent for order ${orderLabel}.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not resend invoice email'));
    }
  }

  async function quickFulfill(order: Order) {
    if (!confirm(`Quick fulfill ${order.order_number || order.id.slice(0, 8)} and generate invoice?`)) return;
    try {
      const result = await fulfillOrderMutation.mutateAsync({ orderId: order.id, items: order.items });
      const orderLabel = order.order_number || order.id.slice(0, 8);
      if (result.emailSent) {
        setNotice(`Order ${orderLabel} fulfilled and invoice emailed.`);
      } else if (result.emailError) {
        setNotice(`Order ${orderLabel} fulfilled. Invoice email skipped: ${result.emailError}`);
      } else {
        setNotice(`Order ${orderLabel} fulfilled.`);
      }
    } catch (err) {
      setError(String((err as Error).message || 'Could not fulfill order'));
    }
  }

  async function saveActualWeight(orderId: string, itemIndex: number) {
    const key = `${orderId}:${itemIndex}`;
    const val = parseFloat(weightInputs[key] ?? '');
    if (!Number.isFinite(val) || val <= 0) { setError('Actual weight must be a positive number.'); return; }
    setSavingWeight((s) => ({ ...s, [key]: true }));
    setError('');
    try {
      const updated = await saveWeightMutation.mutateAsync({ orderId, itemIndex, actualWeight: val });
      if (weightCaptureOrder?.id === orderId) setWeightCaptureOrder(updated);
      setWeightInputs((wi) => { const next = { ...wi }; delete next[key]; return next; });
      setNotice('Actual weight saved. Order total recalculated.');
    } catch (err) {
      setError(String((err as Error).message || 'Could not save actual weight'));
    } finally {
      setSavingWeight((s) => { const next = { ...s }; delete next[key]; return next; });
    }
  }

  function handleEditOrder(order: Order) {
    form.populate(order);
    setNotice(`Editing ${order.order_number || order.id.slice(0, 8)}`);
  }

  function handleToggleWeightCapture(order: Order) {
    setWeightCaptureOrder((prev) => (prev?.id === order.id ? null : order));
    setWeightInputs({});
  }

  const openOrders = orders.filter((order) => {
    const status = normalizedStatus(order.status);
    return status === 'pending' || status === 'in_process';
  });

  const boardOrders = openOrders.filter((order) => {
    if (weightBoardFilter === 'captured') return orderHasCapturedWeights(order);
    if (weightBoardFilter === 'needs') return orderHasPendingWeights(order);
    return false;
  });

  const fetchError = ordersQuery.error
    ? String((ordersQuery.error as Error)?.message || 'Could not load orders')
    : '';
  const displayError = error || fetchError;

  return (
    <div className="space-y-5">
      {ordersQuery.isPending ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading orders...</div> : null}
      {displayError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{displayError}</div> : null}
      {notice  ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}
      {customerIdParam ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Filtered by customer from Customers page: <strong>{customerIdParam}</strong>
        </div>
      ) : null}

      <SmsDraftsPanel />

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Orders"               value={orders.length.toLocaleString()} />
          <SummaryCard title="Pending"              value={summary.pending.toLocaleString()} />
          <SummaryCard title="In Process"           value={summary.inProcess.toLocaleString()} />
          <SummaryCard title="Total Pipeline Value" value={asMoney(summary.totalValue)} />
        </div>
        <button
          onClick={() => setShowWeightStation((v) => !v)}
          className={[
            'shrink-0 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
            showWeightStation
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border-border bg-background hover:bg-muted',
          ].join(' ')}
        >
          {showWeightStation ? '✕ Close Weight Station' : '⚖ Weight Station'}
        </button>
      </div>

      {showWeightStation && (
        <WeightStationPanel
          orders={orders}
          weightInputs={weightInputs}
          savingWeight={savingWeight}
          onWeightInputChange={(key, val) => setWeightInputs((wi) => ({ ...wi, [key]: val }))}
          onSaveWeight={saveActualWeight}
        />
      )}

      {/* ── AI Order Intake modal ── */}
      {(role === 'admin' || role === 'manager') && (
        <div>
          <button
            onClick={() => setIntakeOpen(true)}
            className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            ✦ Parse Customer Message → Order
          </button>
          {intakeOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl">
                <div className="border-b border-border px-5 py-4">
                  <h2 className="font-semibold">Parse Customer Message</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Paste a customer email, text, or fax. AI will extract line items and pre-fill the order form.</p>
                </div>
                <div className="p-5 space-y-3">
                  {intakeError && <div className="rounded border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{intakeError}</div>}
                  <textarea
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={7}
                    placeholder={"e.g. Hi, can I get 10 lbs of salmon, 2 cases of shrimp, and 5 lbs of tuna? – Joe's Seafood"}
                    value={intakeText}
                    onChange={(e) => setIntakeText(e.target.value)}
                    disabled={intakeParsing}
                  />
                </div>
                <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                  <button onClick={() => { setIntakeOpen(false); setIntakeText(''); setIntakeError(''); }} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted" disabled={intakeParsing}>Cancel</button>
                  <button onClick={() => void runOrderIntake()} disabled={intakeParsing || !intakeText.trim()} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {intakeParsing ? 'Parsing...' : 'Parse & Fill'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <OrderFormCard
        editingOrderId={form.editingOrderId}
        customerName={form.customerName}        setCustomerName={form.setCustomerName}
        customerEmail={form.customerEmail}      setCustomerEmail={form.setCustomerEmail}
        customerPhone={form.customerPhone}      setCustomerPhone={form.setCustomerPhone}
        customerAddress={form.customerAddress}  setCustomerAddress={form.setCustomerAddress}
        fulfillmentType={form.fulfillmentType}  setFulfillmentType={form.setFulfillmentType}
        routeId={form.routeId}                  setRouteId={form.setRouteId}
        customers={customers}
        notes={form.notes}                      setNotes={form.setNotes}
        taxEnabled={form.taxEnabled}            setTaxEnabled={form.setTaxEnabled}
        taxRate={form.taxRate}                  setTaxRate={form.setTaxRate}
        fuelPercent={form.fuelPercent}          setFuelPercent={form.setFuelPercent}
        servicePercent={form.servicePercent}    setServicePercent={form.setServicePercent}
        minimumFlat={form.minimumFlat}          setMinimumFlat={form.setMinimumFlat}
        lines={form.lines}
        products={products}
        productsLoading={productsQuery.isPending}
        lotsCache={lotsCache}
        ftlSet={form.ftlSet}
        catchWeightSet={form.catchWeightSet}
        subtotal={form.subtotal}
        charges={form.charges}
        draftTotal={form.draftTotal}
        updateLine={form.updateLine}
        toggleLineCatchWeight={form.toggleLineCatchWeight}
        addLine={form.addLine}
        removeLine={form.removeLine}
        onSubmit={submitOrder}
        onCancel={form.reset}
        submitting={submitting}
      />

      <OrdersWorkbench
        orders={orders}
        customerIdParam={customerIdParam}
        search={search}
        setSearch={setSearch}
        status={status}
        setStatus={setStatus}
        weightCaptureOrderId={weightCaptureOrder?.id ?? null}
        role={role}
        onLoad={() => void queryClient.invalidateQueries({ queryKey: orderKeys.all })}
        onEdit={handleEditOrder}
        onSend={sendOrder}
        onMarkDelivered={markOrderDelivered}
        onResendInvoice={resendInvoiceEmail}
        onFulfill={quickFulfill}
        onToggleWeightCapture={handleToggleWeightCapture}
        onDelete={deleteOrder}
      />

      {weightBoardFilter ? (
        <OrderWeightsBoard
          orders={boardOrders}
          filter={weightBoardFilter}
          role={role}
          weightInputs={weightInputs}
          savingWeight={savingWeight}
          onWeightInputChange={(key: string, value: string) => setWeightInputs((current) => ({ ...current, [key]: value }))}
          onSaveWeight={saveActualWeight}
        />
      ) : null}

      {weightCaptureOrder ? (
        <WeightCaptureCard
          order={weightCaptureOrder}
          weightInputs={weightInputs}
          savingWeight={savingWeight}
          role={role}
          onWeightInputChange={(key: string, val: string) => setWeightInputs((wi) => ({ ...wi, [key]: val }))}
          onSaveWeight={saveActualWeight}
        />
      ) : null}

      {(role === 'admin' || role === 'manager' || role === 'superadmin') && (
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>✦ Pricing Anomaly Detection</CardTitle>
              <CardDescription>
                {pricingAnomalies.data?.summary || 'Identify orders where items were sold significantly below the average price.'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Lookback
                <select
                  value={anomalyDays}
                  onChange={(e) => setAnomalyDays(Number(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void pricingAnomalies.mutate(anomalyDays)}
                disabled={pricingAnomalies.isPending}
              >
                {pricingAnomalies.isPending ? 'Scanning…' : 'Scan for Anomalies'}
              </Button>
            </div>
          </CardHeader>
          {pricingAnomalies.error && (
            <CardContent>
              <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                {String((pricingAnomalies.error as Error)?.message || 'Pricing anomaly scan failed')}
              </div>
            </CardContent>
          )}
          {pricingAnomalies.data && (
            <CardContent>
              {pricingAnomalies.data.anomalies.length === 0 ? (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  No pricing anomalies detected in the last {pricingAnomalies.data.lookback_days} days.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3 text-left font-semibold">Order</th>
                        <th className="py-2 pr-3 text-left font-semibold">Customer</th>
                        <th className="py-2 pr-3 text-left font-semibold">Item</th>
                        <th className="py-2 pr-3 text-right font-semibold">Sale Price</th>
                        <th className="py-2 pr-3 text-right font-semibold">Avg Price</th>
                        <th className="py-2 text-right font-semibold">% Below Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingAnomalies.data.anomalies.map((a, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="py-2 pr-3 font-medium">{a.order_number || a.order_id.slice(0, 8)}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{a.customer_name || '—'}</td>
                          <td className="py-2 pr-3">
                            <span className="font-medium">{a.description}</span>
                            <span className="ml-1 text-xs text-muted-foreground">#{a.item_number}</span>
                          </td>
                          <td className="py-2 pr-3 text-right">{asMoney(a.sale_price)}</td>
                          <td className="py-2 pr-3 text-right text-muted-foreground">{asMoney(a.avg_price)}</td>
                          <td className="py-2 text-right">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              a.severity === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              -{a.pct_below.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

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
