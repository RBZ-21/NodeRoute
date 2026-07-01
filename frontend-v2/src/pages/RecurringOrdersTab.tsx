import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Modal } from '../components/ui/overlay-panel';
import { LoadingSkeleton } from '../components/ui/data-state';
import {
  useRecurringOrders,
  useSaveRecurringOrder,
  useDeleteRecurringOrder,
  type RecurringOrder,
  type RecurringOrderItem,
} from '../hooks/useRecurringOrders';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function emptyItem(): RecurringOrderItem {
  return { item_number: '', name: '', unit: 'each', quantity: 1, unit_price: 0 };
}

type Draft = {
  id?: string;
  customer_name: string;
  customer_email: string;
  customer_address: string;
  schedule_days: number[];
  items: RecurringOrderItem[];
  route_template_id: string;
  notes: string;
  active: boolean;
};

function toDraft(order?: RecurringOrder): Draft {
  return {
    id: order?.id,
    customer_name: order?.customer_name || '',
    customer_email: order?.customer_email || '',
    customer_address: order?.customer_address || '',
    schedule_days: order?.schedule_days || [],
    items: order?.items?.length ? order.items.map((i) => ({ ...i })) : [emptyItem()],
    route_template_id: order?.route_template_id || '',
    notes: order?.notes || '',
    active: order?.active ?? true,
  };
}

export function RecurringOrdersTab() {
  const recurringQuery = useRecurringOrders();
  const saveMutation = useSaveRecurringOrder();
  const deleteMutation = useDeleteRecurringOrder();

  const [editor, setEditor] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const orders = recurringQuery.data ?? [];

  function openNew() { setError(''); setEditor(toDraft()); }
  function openEdit(order: RecurringOrder) { setError(''); setEditor(toDraft(order)); }

  function toggleDay(day: number) {
    setEditor((d) => d ? { ...d, schedule_days: d.schedule_days.includes(day) ? d.schedule_days.filter((x) => x !== day) : [...d.schedule_days, day].sort() } : d);
  }

  function updateItem(idx: number, patch: Partial<RecurringOrderItem>) {
    setEditor((d) => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, ...patch } : it) } : d);
  }

  async function save() {
    if (!editor) return;
    if (!editor.customer_name.trim()) { setError('Customer name is required.'); return; }
    if (!editor.schedule_days.length) { setError('Select at least one delivery day.'); return; }
    const items = editor.items.filter((i) => Number(i.quantity) > 0 && (i.item_number || i.name));
    if (!items.length) { setError('Add at least one item with quantity greater than 0.'); return; }
    setError('');
    try {
      await saveMutation.mutateAsync({
        id: editor.id,
        body: {
          customer_name: editor.customer_name.trim(),
          customer_email: editor.customer_email.trim() || null,
          customer_address: editor.customer_address.trim() || null,
          schedule_days: editor.schedule_days,
          items,
          route_template_id: editor.route_template_id.trim() || null,
          notes: editor.notes.trim() || null,
          active: editor.active,
        },
      });
      setEditor(null);
    } catch (err) {
      setError(String((err as Error).message || 'Could not save standing order.'));
    }
  }

  async function togglePause(order: RecurringOrder) {
    await saveMutation.mutateAsync({ id: order.id, body: { active: !order.active } });
  }

  async function remove(order: RecurringOrder) {
    if (!confirm(`Delete standing order for ${order.customer_name}?`)) return;
    await deleteMutation.mutateAsync(order.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Standing Orders</h2>
          <p className="text-sm text-muted-foreground">Auto-generate orders the evening before each scheduled delivery day.</p>
        </div>
        <Button onClick={openNew}>+ New Standing Order</Button>
      </div>

      {recurringQuery.isPending ? <LoadingSkeleton rows={2} label="Loading standing orders" /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {orders.map((order) => (
          <Card key={order.id} className={order.active ? '' : 'opacity-60'}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{order.customer_name}</CardTitle>
                <Badge variant={order.active ? 'success' : 'secondary'}>{order.active ? 'Active' : 'Paused'}</Badge>
              </div>
              <CardDescription>
                {order.schedule_days.map((d) => DAY_LABELS[d]).join(', ') || 'No days'} · {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                {order.next_run_date ? ` · Next: ${order.next_run_date}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openEdit(order)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => void togglePause(order)}>{order.active ? 'Pause' : 'Resume'}</Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove(order)}>Delete</Button>
            </CardContent>
          </Card>
        ))}
        {!recurringQuery.isPending && orders.length === 0 ? (
          <div className="space-y-2 rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground md:col-span-2">
            <div className="font-medium text-foreground">No standing orders yet.</div>
            <div>Create one to auto-generate recurring orders.</div>
            <Button size="sm" onClick={openNew}>+ New Standing Order</Button>
          </div>
        ) : null}
      </div>

      <Modal
        open={!!editor}
        title={editor?.id ? 'Edit Standing Order' : 'New Standing Order'}
        description="Orders generate automatically the evening before each scheduled day."
        onClose={() => setEditor(null)}
      >
        {editor ? (
          <div className="space-y-4">
            {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Customer Name</span>
                <Input value={editor.customer_name} onChange={(e) => setEditor({ ...editor, customer_name: e.target.value })} placeholder="Harbor Cafe" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Customer Email</span>
                <Input value={editor.customer_email} onChange={(e) => setEditor({ ...editor, customer_email: e.target.value })} placeholder="orders@harbor.test" />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-semibold text-muted-foreground">Delivery Address</span>
                <Input value={editor.customer_address} onChange={(e) => setEditor({ ...editor, customer_address: e.target.value })} placeholder="123 Harbor St" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Route Template ID (optional)</span>
                <Input value={editor.route_template_id} onChange={(e) => setEditor({ ...editor, route_template_id: e.target.value })} placeholder="route id" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted-foreground">Notes</span>
                <Input value={editor.notes} onChange={(e) => setEditor({ ...editor, notes: e.target.value })} placeholder="Optional" />
              </label>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-semibold text-muted-foreground">Delivery Days</span>
              <div className="flex flex-wrap gap-1.5">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={[
                      'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                      editor.schedule_days.includes(day) ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-semibold text-muted-foreground">Items</span>
              {editor.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <Input className="col-span-3" value={item.item_number || ''} onChange={(e) => updateItem(idx, { item_number: e.target.value })} placeholder="Item #" />
                  <Input className="col-span-4" value={item.name || ''} onChange={(e) => updateItem(idx, { name: e.target.value })} placeholder="Description" />
                  <Input className="col-span-2" type="number" min="0" value={item.quantity ?? ''} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} placeholder="Qty" />
                  <Input className="col-span-2" type="number" min="0" step="0.01" value={item.unit_price ?? ''} onChange={(e) => updateItem(idx, { unit_price: Number(e.target.value) })} placeholder="$" />
                  <button type="button" className="col-span-1 text-destructive" onClick={() => setEditor({ ...editor, items: editor.items.filter((_, i) => i !== idx) })} aria-label="Remove item">✕</button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setEditor({ ...editor, items: [...editor.items, emptyItem()] })}>+ Add Item</Button>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
              <Button onClick={() => void save()} disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : 'Save Standing Order'}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
