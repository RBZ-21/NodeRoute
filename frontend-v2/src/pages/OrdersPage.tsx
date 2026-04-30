import { useEffect, useMemo, useState } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { getUserRole, sendWithAuth } from '../lib/api';
import { useOrderForm } from '../hooks/useOrderForm';
import { useOrdersData } from '../hooks/useOrdersData';
import { OrderFormCard } from './OrderFormCard';
import { OrdersWorkbench } from './OrdersWorkbench';
import { WeightCaptureCard } from './WeightCaptureCard';
import { asMoney, asNumber, calcOrderTotal, normalizedStatus } from './orders.types';
import type { Order, OrderStatus } from './orders.types';

export function OrdersPage() {
  const { orders, setOrders, customers, products, lotsCache, loading, error, setError, load, loadLotsForProduct, customerIdParam } = useOrdersData();
  const form = useOrderForm({ products, lotsCache });

  const [notice, setNotice]   = useState('');
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState<OrderStatus | 'all'>('all');
  const [submitting, setSubmitting] = useState(false);
  const [weightCaptureOrder, setWeightCaptureOrder] = useState<Order | null>(null);
  const [weightInputs, setWeightInputs]             = useState<Record<string, string>>({});
  const [savingWeight, setSavingWeight]             = useState<Record<string, boolean>>({});

  const role = getUserRole();

  useEffect(() => {
    for (const line of form.lines) {
      const num = line.itemNumber.trim();
      if (num) void loadLotsForProduct(num);
    }
  }, [form.lines.map((l) => l.itemNumber).join(',')]);

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
      let order: Order;
      if (form.editingOrderId) {
        order = await sendWithAuth<Order>(`/api/orders/${form.editingOrderId}`, 'PATCH', payload);
      } else {
        order = await sendWithAuth<Order>('/api/orders', 'POST', payload);
      }
      if (sendToProcessing) {
        await sendWithAuth(`/api/orders/${order.id}/send`, 'POST', { taxEnabled: payload.taxEnabled, taxRate: payload.taxRate });
      }
      setNotice(
        form.editingOrderId
          ? sendToProcessing ? 'Order updated and sent to processing.' : 'Order updated.'
          : sendToProcessing ? 'Order created and sent to processing.' : 'Order created.',
      );
      form.reset();
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

  async function saveActualWeight(orderId: string, itemIndex: number) {
    const key = `${orderId}:${itemIndex}`;
    const val = parseFloat(weightInputs[key] ?? '');
    if (!Number.isFinite(val) || val <= 0) { setError('Actual weight must be a positive number.'); return; }
    setSavingWeight((s) => ({ ...s, [key]: true }));
    setError('');
    try {
      const updated = await sendWithAuth<Order>(`/api/orders/${orderId}/items/${itemIndex}/actual-weight`, 'PATCH', { actual_weight: val });
      setOrders((current) => current.map((o) => (o.id === orderId ? updated : o)));
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
        <SummaryCard title="Orders"               value={orders.length.toLocaleString()} />
        <SummaryCard title="Pending"              value={summary.pending.toLocaleString()} />
        <SummaryCard title="In Process"           value={summary.inProcess.toLocaleString()} />
        <SummaryCard title="Total Pipeline Value" value={asMoney(summary.totalValue)} />
      </div>

      <OrderFormCard
        editingOrderId={form.editingOrderId}
        customerName={form.customerName}        setCustomerName={form.setCustomerName}
        customerEmail={form.customerEmail}      setCustomerEmail={form.setCustomerEmail}
        customerAddress={form.customerAddress}  setCustomerAddress={form.setCustomerAddress}
        customers={customers}
        notes={form.notes}                      setNotes={form.setNotes}
        taxEnabled={form.taxEnabled}            setTaxEnabled={form.setTaxEnabled}
        taxRate={form.taxRate}                  setTaxRate={form.setTaxRate}
        fuelPercent={form.fuelPercent}          setFuelPercent={form.setFuelPercent}
        servicePercent={form.servicePercent}    setServicePercent={form.setServicePercent}
        minimumFlat={form.minimumFlat}          setMinimumFlat={form.setMinimumFlat}
        lines={form.lines}
        products={products}
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
        onLoad={load}
        onEdit={handleEditOrder}
        onSend={sendOrder}
        onFulfill={quickFulfill}
        onToggleWeightCapture={handleToggleWeightCapture}
        onDelete={deleteOrder}
      />

      {weightCaptureOrder ? (
        <WeightCaptureCard
          order={weightCaptureOrder}
          weightInputs={weightInputs}
          savingWeight={savingWeight}
          role={role}
          onWeightInputChange={(key, val) => setWeightInputs((wi) => ({ ...wi, [key]: val }))}
          onSaveWeight={saveActualWeight}
        />
      ) : null}
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
