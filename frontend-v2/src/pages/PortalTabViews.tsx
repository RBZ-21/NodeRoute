import { Download } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  asNumber,
  formatDate,
  formatMoney,
  invoiceItemsSnippet,
  paymentMethodLabel,
  statusVariant,
} from './portal.types';
import type {
  PaymentMethod,
  PortalAutopay,
  PortalContact,
  PortalInvoice,
  PortalOrder,
  PortalPaymentConfig,
  SeafoodInventoryItem,
} from './portal.types';

// ── Shared mini-components ────────────────────────────────────────────────────

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
      <div className="font-semibold text-foreground">{title}</div>
      <div className="mt-2">{description}</div>
    </div>
  );
}

export function LoadingCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/80 bg-muted/20">
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

export function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}

// ── Tab views ─────────────────────────────────────────────────────────────────

export function OrdersTab({ orders }: { orders: PortalOrder[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        <CardDescription>Your recent order activity and routing details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {orders.length ? (
          orders.map((order) => (
            <div key={order.id} className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-primary">{order.order_number || order.id.slice(0, 8)}</div>
                  <div className="mt-1 text-sm text-foreground">{order.customer_name || 'Customer order'}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{formatDate(order.created_at)}</div>
                </div>
                <Badge variant={statusVariant(order.status)}>{String(order.status || 'unknown').replace('_', ' ')}</Badge>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                <div>Address: {order.customer_address || '—'}</div>
                <div>Driver: {order.driver_name || 'Pending assignment'}</div>
              </div>
              {invoiceItemsSnippet(order.items) ? (
                <div className="mt-3 text-sm text-muted-foreground">Items: {invoiceItemsSnippet(order.items)}</div>
              ) : null}
              {order.notes ? <div className="mt-3 text-sm text-muted-foreground">Notes: {order.notes}</div> : null}
            </div>
          ))
        ) : (
          <EmptyState
            title="No orders available"
            description="Once your account has order history, it will appear here automatically."
          />
        )}
      </CardContent>
    </Card>
  );
}

export function InvoicesTab({
  invoices,
  onDownload,
}: {
  invoices: PortalInvoice[];
  onDownload: (invoiceId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>Download signed invoice PDFs and review invoice status.</CardDescription>
      </CardHeader>
      <CardContent className="rounded-lg border border-border bg-card p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length ? (
              invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.invoice_number || invoice.id.slice(0, 8)}</TableCell>
                  <TableCell>{formatDate(invoice.created_at)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(invoice.status)}>{String(invoice.status || 'unknown')}</Badge>
                  </TableCell>
                  <TableCell>{formatMoney(invoice.total)}</TableCell>
                  <TableCell>{invoice.driver_name || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => onDownload(invoice.id)}>
                      <Download className="mr-2 h-4 w-4" />
                      PDF
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No invoices are available for this customer account yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function PaymentsTab({
  config,
  methods,
  autopay,
  busy,
  onCheckout,
  onRunAutopay,
}: {
  config: PortalPaymentConfig | null;
  methods: PaymentMethod[];
  autopay: PortalAutopay;
  busy: boolean;
  onCheckout: () => void;
  onRunAutopay: () => void;
}) {
  const providerName = String(config?.provider || 'manual').toUpperCase();
  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader>
          <CardTitle>Payment Options</CardTitle>
          <CardDescription>
            {config?.enabled
              ? `Online checkout is enabled through ${providerName}.`
              : 'Online checkout is not fully enabled yet. Use manual payment instructions if needed.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Balance</div>
            <div className="mt-2 text-3xl font-semibold text-foreground">{formatMoney(config?.balance?.openBalance || 0)}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {config?.balance?.openInvoiceCount || 0} open invoice{config?.balance?.openInvoiceCount === 1 ? '' : 's'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onCheckout} disabled={busy || !config?.enabled}>
              {busy ? 'Opening Checkout...' : 'Pay Open Balance'}
            </Button>
            <Button variant="outline" disabled={busy || !autopay?.enabled} onClick={onRunAutopay}>
              Run Autopay Now
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            Support email: {config?.support_email || 'Contact your NodeRoute representative'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Payment Profile</CardTitle>
          <CardDescription>Current methods and autopay status from the live backend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {methods.length ? (
            methods.map((method) => (
              <div key={method.id} className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{paymentMethodLabel(method)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {String(method.method_type || '').replace('_', ' ')} {method.label ? `· ${method.label}` : ''}
                    </div>
                  </div>
                  {method.is_default ? <Badge variant="success">Default</Badge> : <Badge variant="neutral">Saved</Badge>}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              title="No saved methods"
              description="A payment method will appear here once it has been added to your portal profile."
            />
          )}
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
            <div className="font-semibold text-foreground">Autopay</div>
            <div className="mt-2 text-muted-foreground">
              {autopay?.enabled
                ? `Enabled${autopay.autopay_day_of_month ? ` · day ${autopay.autopay_day_of_month} of the month` : ''}`
                : 'Disabled'}
            </div>
            <div className="mt-1 text-muted-foreground">Next run: {formatDate(autopay?.next_run_at || undefined)}</div>
            {autopay?.max_amount ? (
              <div className="mt-1 text-muted-foreground">Max charge: {formatMoney(autopay.max_amount)}</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ContactTab({
  contact,
  onChange,
  onSave,
  busy,
  notice,
}: {
  contact: PortalContact;
  onChange: (next: PortalContact) => void;
  onSave: () => void;
  busy: boolean;
  notice: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact Information</CardTitle>
        <CardDescription>Update delivery contact info, address details, and door code.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
          <Input value={contact.name || ''} onChange={(e) => onChange({ ...contact, name: e.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone</span>
          <Input value={contact.phone || ''} onChange={(e) => onChange({ ...contact, phone: e.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
          <Input value={contact.email || ''} disabled />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</span>
          <Input value={contact.company || ''} onChange={(e) => onChange({ ...contact, company: e.target.value })} />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</span>
          <Input value={contact.address || ''} onChange={(e) => onChange({ ...contact, address: e.target.value })} />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Door / Access Code</span>
          <Input value={contact.door_code || ''} onChange={(e) => onChange({ ...contact, door_code: e.target.value })} />
        </label>
        <div className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onSave} disabled={busy}>
              {busy ? 'Saving...' : 'Save Changes'}
            </Button>
            {notice ? <span className="text-sm text-muted-foreground">{notice}</span> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PricingTab({
  items,
  markupPercent,
  onMarkupChange,
}: {
  items: Array<{ description: string; unit: string; unitPrice: number }>;
  markupPercent: string;
  onMarkupChange: (value: string) => void;
}) {
  const markup = Math.max(0, asNumber(markupPercent, 0));
  const multiplier = 1 + markup / 100;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing Help</CardTitle>
        <CardDescription>Estimate retail pricing by applying your preferred markup over recent invoice item costs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-4">
          <span className="text-sm font-medium text-muted-foreground">Markup</span>
          <Input
            className="w-24"
            value={markupPercent}
            onChange={(e) => onMarkupChange(e.target.value)}
            inputMode="decimal"
          />
          <span className="text-sm font-semibold text-primary">%</span>
          <span className="text-sm text-muted-foreground">A $10.00 item becomes {formatMoney((10 * multiplier).toFixed(2))}</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Recent Cost</TableHead>
                <TableHead>Suggested Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length ? (
                items.map((item) => (
                  <TableRow key={item.description}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell>{item.unit || '—'}</TableCell>
                    <TableCell>{formatMoney(item.unitPrice)}</TableCell>
                    <TableCell>{formatMoney(item.unitPrice * multiplier)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Pricing suggestions will populate after invoice items begin flowing into the portal.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function FishTab({
  items,
  query,
  onQueryChange,
  totalItems,
}: {
  items: SeafoodInventoryItem[];
  query: string;
  onQueryChange: (value: string) => void;
  totalItems: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fresh Fish</CardTitle>
        <CardDescription>
          {items.length} of {totalItems} seafood item{totalItems === 1 ? '' : 's'} currently visible.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Search fish or category"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="max-w-sm"
        />
        <div className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length ? (
                items.map((item) => (
                  <TableRow key={`${item.description}-${item.updated_at || item.created_at || ''}`}>
                    <TableCell className="font-medium">{item.description || 'Seafood Item'}</TableCell>
                    <TableCell>{item.category || 'Other'}</TableCell>
                    <TableCell>
                      {asNumber(item.on_hand_qty, 0)}
                      {asNumber(item.on_hand_weight, 0) > 0 ? ` (${asNumber(item.on_hand_weight, 0)} lb)` : ''}
                    </TableCell>
                    <TableCell>{item.unit || '—'}</TableCell>
                    <TableCell>{formatDate(item.updated_at || item.created_at)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No seafood inventory matches the current search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
