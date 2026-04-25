import {
  CreditCard,
  Download,
  Fish,
  LifeBuoy,
  LogOut,
  Mail,
  Package,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  clearPortalSession,
  fetchPortalBlob,
  fetchWithPortalAuth,
  getPortalToken,
  sendWithPortalAuth,
  setPortalToken,
} from '../lib/portalApi';

type PortalTab = 'orders' | 'invoices' | 'payments' | 'contact' | 'pricing' | 'fresh-fish';

type PortalMe = {
  email: string;
  name: string;
};

type PortalOrder = {
  id: string;
  order_number?: string;
  customer_name?: string;
  customer_address?: string;
  items?: Array<Record<string, unknown>>;
  status?: string;
  notes?: string;
  created_at?: string;
  driver_name?: string;
};

type PortalInvoice = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_address?: string;
  items?: Array<Record<string, unknown>>;
  subtotal?: number | string;
  tax?: number | string;
  total?: number | string;
  status?: string;
  driver_name?: string;
  created_at?: string;
  signed_at?: string;
  sent_at?: string;
};

type PortalContact = {
  email?: string;
  name?: string;
  phone?: string;
  address?: string;
  company?: string;
  door_code?: string;
};

type SeafoodInventoryItem = {
  description?: string;
  category?: string;
  unit?: string;
  on_hand_qty?: number | string;
  on_hand_weight?: number | string;
  cost?: number | string;
  updated_at?: string;
  created_at?: string;
};

type PortalBalance = {
  invoiceCount: number;
  openInvoiceCount: number;
  openBalance: number;
};

type PaymentMethod = {
  id: string;
  method_type?: string;
  provider?: string;
  label?: string | null;
  is_default?: boolean;
  brand?: string | null;
  last4?: string | null;
  bank_name?: string | null;
  account_last4?: string | null;
};

type PortalAutopay = {
  enabled?: boolean;
  autopay_day_of_month?: number | null;
  method_id?: string | null;
  max_amount?: number | string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
};

type PortalPaymentConfig = {
  enabled?: boolean;
  provider?: string;
  support_email?: string;
  currency?: string;
  balance?: PortalBalance;
  payment_methods?: PaymentMethod[];
  autopay?: PortalAutopay;
};

type PortalPaymentProfile = {
  balance?: PortalBalance;
  payment_methods?: PaymentMethod[];
  autopay?: PortalAutopay;
};

type PortalAuthStart = {
  challengeId: string;
  maskedEmail?: string;
  name?: string;
  expiresInSeconds?: number;
};

const tabs: Array<{ id: PortalTab; label: string; icon: typeof Package }> = [
  { id: 'orders', label: 'Orders', icon: Package },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'contact', label: 'Contact Info', icon: Mail },
  { id: 'pricing', label: 'Pricing Help', icon: LifeBuoy },
  { id: 'fresh-fish', label: 'Fresh Fish', icon: Fish },
];

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value: number | string | undefined | null): string {
  const numeric = asNumber(value, 0);
  return numeric.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString();
}

function statusVariant(status: string | undefined): 'warning' | 'secondary' | 'success' | 'neutral' {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pending') return 'warning';
  if (normalized === 'in_process' || normalized === 'processed') return 'secondary';
  if (normalized === 'signed' || normalized === 'sent' || normalized === 'paid' || normalized === 'invoiced') return 'success';
  return 'neutral';
}

function invoiceItemsSnippet(items: Array<Record<string, unknown>> | undefined) {
  const list = Array.isArray(items) ? items : [];
  return list
    .slice(0, 3)
    .map((item) => String(item.description || item.name || item.item || 'Item'))
    .join(', ');
}

function paymentMethodLabel(method: PaymentMethod) {
  if (method.method_type === 'ach_bank') {
    return `${method.bank_name || 'Bank Account'} •••• ${method.account_last4 || '----'}`;
  }
  return `${method.brand || 'Card'} •••• ${method.last4 || '----'}`;
}

export function CustomerPortalPage() {
  const [token, setToken] = useState(() => getPortalToken());
  const [authStep, setAuthStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<PortalTab>('orders');

  const [me, setMe] = useState<PortalMe | null>(null);
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [contact, setContact] = useState<PortalContact>({});
  const [inventory, setInventory] = useState<SeafoodInventoryItem[]>([]);
  const [paymentsConfig, setPaymentsConfig] = useState<PortalPaymentConfig | null>(null);
  const [paymentsProfile, setPaymentsProfile] = useState<PortalPaymentProfile | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactNotice, setContactNotice] = useState('');
  const [markupPercent, setMarkupPercent] = useState('18');
  const [fishSearch, setFishSearch] = useState('');

  async function loadPortalData(mode: 'initial' | 'refresh' = 'initial') {
    if (!getPortalToken()) return;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError('');

    const results = await Promise.allSettled([
      fetchWithPortalAuth<PortalMe>('/api/portal/me'),
      fetchWithPortalAuth<PortalOrder[]>('/api/portal/orders'),
      fetchWithPortalAuth<PortalInvoice[]>('/api/portal/invoices'),
      fetchWithPortalAuth<PortalContact>('/api/portal/contact'),
      fetchWithPortalAuth<SeafoodInventoryItem[]>('/api/portal/inventory'),
      fetchWithPortalAuth<PortalPaymentConfig>('/api/portal/payments/config'),
      fetchWithPortalAuth<PortalPaymentProfile>('/api/portal/payments/profile'),
    ]);

    const firstError = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstError) {
      const message = String(firstError.reason?.message || 'Could not load the customer portal right now.');
      setError(message);
      if (message.toLowerCase().includes('session')) {
        clearPortalSession();
        setToken('');
      }
    }

    if (results[0].status === 'fulfilled') setMe(results[0].value);
    if (results[1].status === 'fulfilled') setOrders(Array.isArray(results[1].value) ? results[1].value : []);
    if (results[2].status === 'fulfilled') setInvoices(Array.isArray(results[2].value) ? results[2].value : []);
    if (results[3].status === 'fulfilled') setContact(results[3].value || {});
    if (results[4].status === 'fulfilled') setInventory(Array.isArray(results[4].value) ? results[4].value : []);
    if (results[5].status === 'fulfilled') setPaymentsConfig(results[5].value || null);
    if (results[6].status === 'fulfilled') setPaymentsProfile(results[6].value || null);

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (!token) return;
    void loadPortalData('initial');
  }, [token]);

  async function requestCode() {
    setAuthSubmitting(true);
    setAuthError('');
    setAuthMessage('');

    try {
      const response = await fetch('/api/portal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = (await response.json()) as Partial<PortalAuthStart> & { error?: string };
      if (!response.ok || !payload.challengeId) {
        throw new Error(payload.error || 'Could not email a verification code.');
      }

      setChallengeId(payload.challengeId);
      setAuthStep('code');
      setAuthMessage(
        payload.maskedEmail
          ? `We sent a secure verification code to ${payload.maskedEmail}.`
          : 'We sent a secure verification code to your inbox.'
      );
    } catch (requestError) {
      setAuthError(String((requestError as Error).message || 'Could not email a verification code.'));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function verifyCode() {
    setAuthSubmitting(true);
    setAuthError('');

    try {
      const response = await fetch('/api/portal/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, code: code.trim() }),
      });
      const payload = (await response.json()) as { token?: string; name?: string; email?: string; error?: string };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error || 'Verification failed.');
      }

      setPortalToken(payload.token);
      setToken(payload.token);
      setMe({ name: payload.name || email.trim(), email: payload.email || email.trim() });
      setAuthMessage('');
      setAuthStep('email');
      setChallengeId('');
      setCode('');
    } catch (verifyError) {
      setAuthError(String((verifyError as Error).message || 'Verification failed.'));
    } finally {
      setAuthSubmitting(false);
    }
  }

  function resetLoginFlow() {
    setAuthStep('email');
    setChallengeId('');
    setCode('');
    setAuthMessage('');
    setAuthError('');
  }

  function logout() {
    clearPortalSession();
    setToken('');
    setMe(null);
    setOrders([]);
    setInvoices([]);
    setInventory([]);
    setPaymentsConfig(null);
    setPaymentsProfile(null);
    setError('');
  }

  async function downloadInvoice(invoiceId: string) {
    try {
      const blob = await fetchPortalBlob(`/api/portal/invoices/${invoiceId}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (downloadError) {
      setError(String((downloadError as Error).message || 'Could not download that invoice.'));
    }
  }

  async function startCheckout() {
    setPaymentBusy(true);
    setError('');
    try {
      const payload = await sendWithPortalAuth<{ checkout_url?: string; error?: string }>(
        '/api/portal/payments/create-checkout-session',
        'POST',
        {}
      );
      if (!payload.checkout_url) {
        throw new Error(payload.error || 'No checkout link was returned.');
      }
      window.location.href = payload.checkout_url;
    } catch (checkoutError) {
      setError(String((checkoutError as Error).message || 'Could not start checkout.'));
      setPaymentBusy(false);
    }
  }

  async function runAutopayNow() {
    setPaymentBusy(true);
    setError('');
    try {
      await sendWithPortalAuth('/api/portal/payments/autopay/charge-now', 'POST', {});
      await loadPortalData('refresh');
    } catch (autopayError) {
      setError(String((autopayError as Error).message || 'Could not run autopay.'));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function saveContact() {
    setContactBusy(true);
    setContactNotice('');
    try {
      await Promise.all([
        sendWithPortalAuth('/api/portal/contact', 'PATCH', {
          name: contact.name || '',
          phone: contact.phone || '',
          address: contact.address || '',
          company: contact.company || '',
        }),
        sendWithPortalAuth('/api/portal/doorcode', 'PATCH', {
          door_code: contact.door_code || '',
        }),
      ]);
      setContactNotice('Contact preferences saved.');
    } catch (contactError) {
      setContactNotice(String((contactError as Error).message || 'Could not save contact details.'));
    } finally {
      setContactBusy(false);
    }
  }

  const paymentBalance = paymentsConfig?.balance?.openBalance ?? paymentsProfile?.balance?.openBalance ?? 0;
  const openInvoiceCount = paymentsConfig?.balance?.openInvoiceCount ?? paymentsProfile?.balance?.openInvoiceCount ?? 0;
  const paymentMethods = paymentsProfile?.payment_methods ?? paymentsConfig?.payment_methods ?? [];
  const autopay = paymentsProfile?.autopay ?? paymentsConfig?.autopay ?? {};

  const pricingItems = useMemo(() => {
    const seen = new Map<string, { description: string; unit: string; unitPrice: number }>();
    invoices.forEach((invoice) => {
      const items = Array.isArray(invoice.items) ? invoice.items : [];
      items.forEach((item) => {
        const description = String(item.description || item.name || item.item || '').trim();
        if (!description) return;
        const key = description.toLowerCase();
        const candidate = {
          description,
          unit: String(item.unit || ''),
          unitPrice: asNumber(item.unit_price ?? item.price ?? item.cost, 0),
        };
        const existing = seen.get(key);
        if (!existing || candidate.unitPrice > existing.unitPrice) {
          seen.set(key, candidate);
        }
      });
    });
    return [...seen.values()].sort((a, b) => a.description.localeCompare(b.description));
  }, [invoices]);

  const filteredFish = useMemo(() => {
    const query = fishSearch.trim().toLowerCase();
    if (!query) return inventory;
    return inventory.filter((item) => {
      const haystack = `${item.description || ''} ${item.category || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [fishSearch, inventory]);

  if (!token) {
    return (
      <div className="min-h-screen bg-enterprise-gradient">
        <div className="mx-auto flex min-h-screen max-w-[1320px] items-center justify-center p-4 md:p-6">
          <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.2fr_430px]">
            <Card className="hidden border-border/80 bg-card/95 shadow-panel lg:block">
              <CardHeader className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                  <ShieldCheck className="h-4 w-4" />
                  Customer Portal V2
                </div>
                <CardTitle className="max-w-xl text-4xl leading-tight">
                  Orders, invoices, payments, and account details in one customer workspace.
                </CardTitle>
                <CardDescription className="max-w-lg text-base">
                  The portal now lives in the same modern UI system as the V2 dashboard while keeping the secure email-code sign in flow your customers already use.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <FeatureCard
                  icon={Receipt}
                  title="Invoice Access"
                  description="Download invoice PDFs, track status, and review order history without waiting on office staff."
                />
                <FeatureCard
                  icon={CreditCard}
                  title="Payments Visibility"
                  description="See open balance, payment configuration, and autopay status from the same portal session."
                />
                <FeatureCard
                  icon={Mail}
                  title="Contact Updates"
                  description="Keep email, phone, address, and door code synced so deliveries arrive with the right details."
                />
                <FeatureCard
                  icon={Waves}
                  title="Fresh Fish Feed"
                  description="Customers can browse in-stock seafood inventory from the portal without calling the office."
                />
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/95 shadow-panel">
              <CardHeader className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                  <Mail className="h-4 w-4" />
                  Secure Portal Sign In
                </div>
                <CardTitle>{authStep === 'email' ? 'Email your code' : 'Enter verification code'}</CardTitle>
                <CardDescription>
                  {authStep === 'email'
                    ? 'Enter your customer email and we will send a short-lived sign-in code.'
                    : 'Use the 6-digit code from your inbox to finish signing in.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {authError ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                    {authError}
                  </div>
                ) : null}
                {authMessage ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                    {authMessage}
                  </div>
                ) : null}

                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@restaurant.com"
                    autoComplete="email"
                    disabled={authStep === 'code'}
                    required
                  />
                </label>

                {authStep === 'code' ? (
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verification Code</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Enter the 6-digit code"
                      required
                    />
                  </label>
                ) : null}

                {authStep === 'email' ? (
                  <Button className="w-full" disabled={authSubmitting || !email.trim()} onClick={requestCode}>
                    {authSubmitting ? 'Sending Code...' : 'Email Verification Code'}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <Button className="w-full" disabled={authSubmitting || code.trim().length !== 6} onClick={verifyCode}>
                      {authSubmitting ? 'Verifying...' : 'Verify and Sign In'}
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" disabled={authSubmitting} onClick={requestCode}>
                        Resend Code
                      </Button>
                      <Button variant="outline" className="flex-1" disabled={authSubmitting} onClick={resetLoginFlow}>
                        Use Another Email
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto max-w-[1320px] p-4 md:p-6">
        <header className="rounded-xl border border-border bg-card shadow-panel">
          <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <Receipt className="h-4 w-4" />
                NodeRoute Customer Portal
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {me?.name || contact.name || me?.email || 'Customer Workspace'}
              </h1>
              <p className="text-sm text-muted-foreground">
                Review orders, invoices, payments, and account details without leaving the portal.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void loadPortalData('refresh')} disabled={refreshing}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
              <Button variant="outline" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card className="border-border/80 bg-muted/20">
              <CardHeader>
                <CardDescription className="text-xs font-semibold uppercase tracking-wide">Open Balance</CardDescription>
                <CardTitle className="text-4xl">{formatMoney(paymentBalance)}</CardTitle>
                <CardDescription>
                  {openInvoiceCount} open invoice{openInvoiceCount === 1 ? '' : 's'} waiting for action.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button onClick={startCheckout} disabled={paymentBusy || !paymentsConfig?.enabled || paymentBalance <= 0}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  {paymentBusy ? 'Opening Checkout...' : 'Pay Online'}
                </Button>
                <Button variant="outline" onClick={() => setActiveTab('payments')}>
                  Payment Options
                </Button>
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <MiniStat label="Orders" value={orders.length.toString()} />
              <MiniStat label="Invoices" value={invoices.length.toString()} />
              <MiniStat label="Saved Methods" value={paymentMethods.length.toString()} />
            </div>
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab(tab.id)}
                className="gap-2"
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Button>
            );
          })}
        </div>

        <main className="mt-4">
          {loading ? <LoadingCard message="Loading your customer portal..." /> : null}
          {!loading && activeTab === 'orders' ? (
            <OrdersTab orders={orders} />
          ) : null}
          {!loading && activeTab === 'invoices' ? (
            <InvoicesTab invoices={invoices} onDownload={downloadInvoice} />
          ) : null}
          {!loading && activeTab === 'payments' ? (
            <PaymentsTab
              config={paymentsConfig}
              methods={paymentMethods}
              autopay={autopay}
              busy={paymentBusy}
              onCheckout={startCheckout}
              onRunAutopay={runAutopayNow}
            />
          ) : null}
          {!loading && activeTab === 'contact' ? (
            <ContactTab
              contact={contact}
              onChange={setContact}
              onSave={() => void saveContact()}
              busy={contactBusy}
              notice={contactNotice}
            />
          ) : null}
          {!loading && activeTab === 'pricing' ? (
            <PricingTab items={pricingItems} markupPercent={markupPercent} onMarkupChange={setMarkupPercent} />
          ) : null}
          {!loading && activeTab === 'fresh-fish' ? (
            <FishTab items={filteredFish} query={fishSearch} onQueryChange={setFishSearch} totalItems={inventory.length} />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Receipt;
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/80 bg-muted/20">
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function LoadingCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}

function OrdersTab({ orders }: { orders: PortalOrder[] }) {
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

function InvoicesTab({
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

function PaymentsTab({
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
            <EmptyState title="No saved methods" description="A payment method will appear here once it has been added to your portal profile." />
          )}

          <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
            <div className="font-semibold text-foreground">Autopay</div>
            <div className="mt-2 text-muted-foreground">
              {autopay?.enabled
                ? `Enabled${autopay.autopay_day_of_month ? ` · day ${autopay.autopay_day_of_month} of the month` : ''}`
                : 'Disabled'}
            </div>
            <div className="mt-1 text-muted-foreground">
              Next run: {formatDate(autopay?.next_run_at || undefined)}
            </div>
            {autopay?.max_amount ? (
              <div className="mt-1 text-muted-foreground">Max charge: {formatMoney(autopay.max_amount)}</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ContactTab({
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
          <Input value={contact.name || ''} onChange={(event) => onChange({ ...contact, name: event.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone</span>
          <Input value={contact.phone || ''} onChange={(event) => onChange({ ...contact, phone: event.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
          <Input value={contact.email || ''} disabled />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</span>
          <Input value={contact.company || ''} onChange={(event) => onChange({ ...contact, company: event.target.value })} />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</span>
          <Input value={contact.address || ''} onChange={(event) => onChange({ ...contact, address: event.target.value })} />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Door / Access Code</span>
          <Input value={contact.door_code || ''} onChange={(event) => onChange({ ...contact, door_code: event.target.value })} />
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

function PricingTab({
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
            onChange={(event) => onMarkupChange(event.target.value)}
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

function FishTab({
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
        <CardDescription>{items.length} of {totalItems} seafood item{totalItems === 1 ? '' : 's'} currently visible.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Search fish or category"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
      <div className="font-semibold text-foreground">{title}</div>
      <div className="mt-2">{description}</div>
    </div>
  );
}
