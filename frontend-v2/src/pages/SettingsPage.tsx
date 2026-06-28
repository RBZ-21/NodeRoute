import { type ChangeEvent, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, ShoppingCart, XCircle } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getUserRole, type Role } from '../lib/api';
import {
  useChangePassword,
  useBillingConfig,
  useCompanySettings,
  useCurrentUser,
  useSaveCompanySettings,
  useSaveProfile,
  useStartBillingCheckout,
  type CutoffOption,
  type BillingConfig,
} from '../hooks/useSettings';

const DEFAULT_HOUR_OPTIONS: CutoffOption[] = [
  { label: '8:00 AM', value: 8 }, { label: '9:00 AM', value: 9 }, { label: '10:00 AM', value: 10 },
  { label: '11:00 AM', value: 11 }, { label: '12:00 PM', value: 12 }, { label: '1:00 PM', value: 13 },
  { label: '2:00 PM', value: 14 }, { label: '3:00 PM', value: 15 }, { label: '4:00 PM', value: 16 },
  { label: '5:00 PM', value: 17 }, { label: '6:00 PM', value: 18 },
];
const DEFAULT_DAY_OPTIONS: CutoffOption[] = [
  { label: 'Day of delivery', value: 'day_of' },
  { label: 'Day before delivery', value: 'day_before' },
];

function roleVariant(role: Role): 'success' | 'secondary' | 'neutral' {
  if (role === 'admin') return 'success';
  if (role === 'manager') return 'secondary';
  return 'neutral';
}
function normalizeRole(value: string | undefined): Role {
  const r = String(value || '').trim().toLowerCase();
  if (r === 'superadmin' || r === 'admin' || r === 'manager' || r === 'driver') return r;
  return 'unknown';
}
function updateLocalUserName(nextName: string) {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.name = nextName;
    localStorage.setItem('nr_user', JSON.stringify(parsed));
  } catch {}
}

function checkoutIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readBillingReturn(): { status: 'success' | 'cancelled'; sessionId?: string } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const billing = String(params.get('billing') || '').toLowerCase();
  if (billing === 'success') return { status: 'success', sessionId: params.get('session_id') || undefined };
  if (billing === 'cancelled' || billing === 'cancel') return { status: 'cancelled' };
  return null;
}

export function SettingsPage() {
  const role = getUserRole() as Role;
  const canManageCompanySettings = role === 'admin' || role === 'manager' || role === 'superadmin';

  const { data: user = {}, isLoading: loadingUser } = useCurrentUser();
  const { data: company = {}, isLoading: loadingCompany } = useCompanySettings();
  const { data: billing = {}, isLoading: loadingBilling } = useBillingConfig();
  const saveProfile = useSaveProfile();
  const changePassword = useChangePassword();
  const saveCompany = useSaveCompanySettings();
  const startBillingCheckout = useStartBillingCheckout();

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [billingReturn] = useState(readBillingReturn);
  const [displayName, setDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Company settings local form state (seeded from query data)
  const [forceDriverSignature, setForceDriverSignature] = useState<boolean | null>(null);
  const [forceDriverProofOfDelivery, setForceDriverProofOfDelivery] = useState<boolean | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [invoiceLogoDataUrl, setInvoiceLogoDataUrl] = useState<string | null | undefined>(undefined);
  const [orderCutoffHour, setOrderCutoffHour] = useState<number | null>(null);
  const [orderCutoffDay, setOrderCutoffDay] = useState<string | null>(null);

  // Use query data as source of truth, override with local state if user has edited
  const sig = forceDriverSignature ?? !!company.forceDriverSignature;
  const pod = forceDriverProofOfDelivery ?? !!company.forceDriverProofOfDelivery;
  const biz = businessName ?? String(company.businessName || user.companyName || '');
  const logo = invoiceLogoDataUrl !== undefined ? invoiceLogoDataUrl : (company.invoiceLogoDataUrl ?? null);
  const cutoffHour = orderCutoffHour ?? (typeof company.orderCutoffHour === 'number' ? company.orderCutoffHour : 14);
  const cutoffDay = orderCutoffDay ?? (typeof company.orderCutoffDay === 'string' ? company.orderCutoffDay : 'day_of');
  const hourOptions = company.cutoffHourOptions?.length ? company.cutoffHourOptions : DEFAULT_HOUR_OPTIONS;
  const dayOptions = company.cutoffDayOptions?.length ? company.cutoffDayOptions : DEFAULT_DAY_OPTIONS;

  const effectiveDisplayName = displayName || String(user.name || '');
  const userRole = useMemo(() => normalizeRole(user.role), [user.role]);
  const loading = loadingUser || loadingCompany;
  const isCompanyDisabled = !canManageCompanySettings || loadingCompany || saveCompany.isPending;

  async function handleSaveProfile() {
    const name = effectiveDisplayName.trim();
    if (!name) { setError('Display name is required.'); return; }
    if (!user.id) { setError('Could not determine current user id.'); return; }
    setError(''); setNotice('');
    try {
      await saveProfile.mutateAsync({ userId: user.id, name });
      updateLocalUserName(name);
      setNotice('Profile updated.');
    } catch (err) { setError(String((err as Error)?.message || 'Failed to update profile')); }
  }

  async function handleSavePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) { setError('Please complete all password fields.'); return; }
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('New password and confirmation do not match.'); return; }
    setError(''); setNotice('');
    try {
      const res = await changePassword.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice(res.message || 'Password updated.');
    } catch (err) { setError(String((err as Error)?.message || 'Failed to update password')); }
  }

  async function handleSaveCompany() {
    if (!canManageCompanySettings) { setError('Only admin and manager roles can update company settings.'); return; }
    setError(''); setNotice('');
    try {
      await saveCompany.mutateAsync({
        forceDriverSignature: sig,
        forceDriverProofOfDelivery: pod,
        businessName: biz.trim(),
        invoiceLogoDataUrl: logo,
        orderCutoffHour: cutoffHour,
        orderCutoffDay: cutoffDay,
      });
      // Reset local overrides — query cache is now fresh
      setForceDriverSignature(null); setForceDriverProofOfDelivery(null);
      setBusinessName(null); setInvoiceLogoDataUrl(undefined);
      setOrderCutoffHour(null); setOrderCutoffDay(null);
      setNotice('Company settings saved.');
    } catch (err) { setError(String((err as Error)?.message || 'Failed to save company settings')); }
  }

  async function handleStartBillingCheckout() {
    setError('');
    setNotice('');
    try {
      const payload = await startBillingCheckout.mutateAsync({ idempotency_key: checkoutIdempotencyKey() });
      if (!payload.checkout_url) throw new Error('No checkout link was returned.');
      window.location.href = payload.checkout_url;
    } catch (err) {
      setError(String((err as Error)?.message || 'Could not start NodeRoute billing checkout.'));
    }
  }

  function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('Invoice logo must be a PNG or JPG image.'); return; }
    if (file.size > 1_000_000) { setError('Invoice logo must be under 1 MB.'); return; }
    setError('');
    const reader = new FileReader();
    reader.onload = () => setInvoiceLogoDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => setError('Could not read the selected logo file.');
    reader.readAsDataURL(file);
  }

  const companyDirty = forceDriverSignature !== null || forceDriverProofOfDelivery !== null ||
    businessName !== null || invoiceLogoDataUrl !== undefined || orderCutoffHour !== null || orderCutoffDay !== null;

  return (
    <div className="space-y-5">
      {loading && <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading settings...</div>}
      {error && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Signed In As" value={String(user.name || '—')} />
        <SummaryCard label="Email" value={String(user.email || '—')} compact />
        <SummaryBadgeCard label="Role" role={userRole} />
        <SummaryCard label="Company" value={String(user.companyName || '—')} compact />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="space-y-1"><CardTitle>Profile</CardTitle><CardDescription>Update your display identity used across operations workflows.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display Name</span>
              <Input value={effectiveDisplayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadonlyField label="Email" value={String(user.email || '—')} />
              <ReadonlyField label="Location" value={String(user.locationName || '—')} />
            </div>
            <Button onClick={handleSaveProfile} disabled={saveProfile.isPending}>
              {saveProfile.isPending ? 'Saving Profile...' : 'Save Profile'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1"><CardTitle>Security</CardTitle><CardDescription>Rotate your password with immediate effect for this account.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Password</span>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Password</span>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Confirm New Password</span>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat new password" />
            </label>
            <Button onClick={handleSavePassword} disabled={changePassword.isPending}>
              {changePassword.isPending ? 'Updating Password...' : 'Update Password'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <NodeRouteBillingCard
        billing={billing}
        billingReturn={billingReturn}
        loading={loadingBilling}
        busy={startBillingCheckout.isPending}
        onCheckout={() => void handleStartBillingCheckout()}
      />

      <Card>
        <CardHeader className="space-y-1"><CardTitle>Company Controls</CardTitle><CardDescription>Operational policy controls aligned with dispatch and delivery compliance.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="space-y-1 text-sm block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business Name</span>
            <Input value={biz} onChange={(e) => setBusinessName(e.target.value)} placeholder="Your business name" disabled={isCompanyDisabled} />
            <div className="text-xs text-muted-foreground">Shown at the top of invoices and invoice emails.</div>
          </label>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice Logo</div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-4">
              {logo ? (
                <img src={logo} alt="Invoice logo preview" className="h-16 max-w-[220px] rounded border border-border bg-white object-contain p-2" />
              ) : (
                <div className="flex h-16 w-40 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">No logo uploaded</div>
              )}
              <div className="space-y-2">
                <Input type="file" accept="image/png,image/jpeg" onChange={handleLogoUpload} disabled={isCompanyDisabled} />
                <div className="text-xs text-muted-foreground">PNG or JPG only, up to 1 MB.</div>
                {logo && <Button variant="ghost" size="sm" onClick={() => setInvoiceLogoDataUrl(null)} disabled={isCompanyDisabled}>Remove Logo</Button>}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Order Cutoff Time</div>
              <div className="mt-1 text-xs text-muted-foreground">Orders received after this time will not be included in the daily fish blast for that delivery window.</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cutoff Time</span>
                <Select value={String(cutoffHour)} onValueChange={(v) => setOrderCutoffHour(Number(v))} disabled={isCompanyDisabled}>
                  <SelectTrigger><SelectValue placeholder="Select time" /></SelectTrigger>
                  <SelectContent>{hourOptions.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relative To Delivery</span>
                <Select value={cutoffDay} onValueChange={(v) => setOrderCutoffDay(v)} disabled={isCompanyDisabled}>
                  <SelectTrigger><SelectValue placeholder="Select day" /></SelectTrigger>
                  <SelectContent>{dayOptions.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Current setting: orders must be placed by <strong>{hourOptions.find((o) => o.value === cutoffHour)?.label ?? `${cutoffHour}:00`}</strong> on the <strong>{cutoffDay === 'day_before' ? 'day before' : 'day of'}</strong> delivery.
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">Force Driver Signature</div>
              <div className="mt-1 text-xs text-muted-foreground">Require signature capture before proof-of-delivery completion.</div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Off</span>
              <input type="checkbox" className="h-4 w-4 rounded border-input" checked={sig} onChange={(e) => setForceDriverSignature(e.target.checked)} disabled={isCompanyDisabled} />
              <span className="text-xs font-medium text-muted-foreground">On</span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">Proof Of Delivery Photo</div>
              <div className="mt-1 text-xs text-muted-foreground">Require drivers to capture and upload a delivery photo from their mobile device before completing the stop.</div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Off</span>
              <input type="checkbox" className="h-4 w-4 rounded border-input" checked={pod} onChange={(e) => setForceDriverProofOfDelivery(e.target.checked)} disabled={isCompanyDisabled} />
              <span className="text-xs font-medium text-muted-foreground">On</span>
            </label>
          </div>

          {!canManageCompanySettings && <div className="text-xs text-muted-foreground">Only admin and manager roles can save company controls.</div>}
          <Button variant="outline" onClick={handleSaveCompany} disabled={!canManageCompanySettings || !companyDirty || saveCompany.isPending || loadingCompany}>
            {saveCompany.isPending ? 'Saving Company Controls...' : 'Save Company Controls'}
          </Button>
        </CardContent>
      </Card>

      {/* ── Add-on: Customer Portal Online Ordering ── */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <CardTitle>Online Ordering</CardTitle>
            <Badge variant="secondary">Add-on</Badge>
          </div>
          <CardDescription>Let your customers place orders themselves, directly from your live catalog.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="grid gap-2 sm:grid-cols-2">
            <li className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Customers browse your real-time, in-stock catalog with their pricing.</li>
            <li className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Portal orders land in your order queue, flagged as Portal.</li>
            <li className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />One-tap reordering from any past order.</li>
            <li className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Fewer phone calls and faxes; faster, more accurate orders.</li>
          </ul>
          <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            Online Ordering is a paid add-on. Contact us to enable it for your company.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NodeRouteBillingCard({
  billing,
  billingReturn,
  loading,
  busy,
  onCheckout,
}: {
  billing: BillingConfig;
  billingReturn: { status: 'success' | 'cancelled'; sessionId?: string } | null;
  loading: boolean;
  busy: boolean;
  onCheckout: () => void;
}) {
  const company = billing.company || {};
  const canManageBilling = billing.can_manage_billing !== false;
  const showTestPreview = !!billing.test_mode || !!billingReturn;
  const success = billingReturn?.status === 'success';
  const ReturnIcon = success ? CheckCircle2 : XCircle;
  const readinessMessage = billing.live_mode_blocked
    ? 'Live Stripe keys are present but blocked for this preview. Switch to sk_test_ and pk_test_ keys to test subscription checkout safely.'
    : billing.message || 'Stripe subscription checkout is not fully configured yet.';

  return (
    <Card className="border-sky-200 bg-sky-50/40">
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <CreditCard className="h-5 w-5 text-sky-700" />
          <CardTitle>NodeRoute Billing</CardTitle>
          {billing.test_mode ? <Badge variant="secondary">Test Preview</Badge> : null}
        </div>
        <CardDescription>Subscription checkout for distributors paying for NodeRoute access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showTestPreview ? (
          <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm text-sky-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Stripe test mode preview — no live charges</div>
              <div className="mt-1 text-sky-800">
                This is for NodeRoute service billing, not restaurant invoice collection.
              </div>
            </div>
          </div>
        ) : null}

        {billingReturn ? (
          <div
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
              success
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            <ReturnIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">{success ? 'Test subscription checkout returned' : 'Subscription checkout canceled'}</div>
              <div className="mt-1">
                {success
                  ? 'Stripe redirected back after the hosted test checkout. Do not activate billing entitlements until verified subscription webhooks are enabled.'
                  : 'No subscription change was made. The company plan remains unchanged.'}
              </div>
              {billingReturn.sessionId ? (
                <div className="mt-2 rounded border border-current/20 bg-white/60 px-2 py-1 font-mono text-xs">
                  Session {billingReturn.sessionId}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {!billing.enabled && !loading ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">Subscription checkout not enabled</div>
            <div className="mt-1">{readinessMessage}</div>
            {billing.readiness_code ? <div className="mt-2 font-mono text-xs">{billing.readiness_code}</div> : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <ReadonlyField label="Company" value={String(company.name || '—')} />
          <ReadonlyField label="Plan" value={String(company.plan || 'starter')} />
          <ReadonlyField label="Status" value={String(company.status || 'active')} />
        </div>

        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subscription</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {billing.product_name || 'NodeRoute Platform Subscription'}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{billing.price_label || 'Configured in Stripe'}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onCheckout} disabled={loading || busy || !billing.enabled || !canManageBilling}>
            <CreditCard className="mr-2 h-4 w-4" />
            {busy ? 'Opening Checkout...' : 'Pay Now with Stripe'}
          </Button>
          {!canManageBilling ? (
            <span className="text-xs text-muted-foreground">Only company admins can manage NodeRoute billing.</span>
          ) : null}
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          Billing support: {billing.support_email || 'support@noderoute.com'}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className={compact ? 'text-base' : 'text-2xl'}>{value}</CardTitle></CardHeader></Card>
  );
}
function SummaryBadgeCard({ label, role }: { label: string; role: Role }) {
  return (
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><div><Badge variant={roleVariant(role)}>{role === 'unknown' ? 'Unknown' : role.charAt(0).toUpperCase() + role.slice(1)}</Badge></div></CardHeader></Card>
  );
}
function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
