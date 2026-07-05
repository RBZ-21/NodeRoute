import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SlideOver } from '../../components/ui/overlay-panel';
import { SelectInput } from '../../components/ui/select-input';
import { useToast } from '../../components/ui/toast';
import { useCompanyBilling, useSaveCompanyBilling } from '../../hooks/useSuperadminBilling';
import { AddonChecklist } from './AddonChecklist';
import { FeatureMatrixTable } from './FeatureMatrixTable';
import type {
  BillingStatus,
  CompanyAddonEntitlement,
  CompanyBillingResponse,
  CompanyFeatureEntitlement,
  PlanTierCode,
} from './billing-types';

function centsToDollars(cents: number | null | undefined) {
  if (cents == null) return '';
  return String(Math.round(cents / 100));
}

function dollarsToCents(value: string) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function ClientBillingDrawer({
  companyId,
  open,
  onClose,
  onSaved,
}: {
  companyId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { data, isLoading, error } = useCompanyBilling(open ? companyId : null);
  const save = useSaveCompanyBilling(companyId);
  const [tier, setTier] = useState<PlanTierCode>('track');
  const [status, setStatus] = useState<BillingStatus>('trial');
  const [customPricing, setCustomPricing] = useState(false);
  const [monthly, setMonthly] = useState('');
  const [setup, setSetup] = useState('');
  const [notes, setNotes] = useState('');
  const [features, setFeatures] = useState<CompanyFeatureEntitlement[]>([]);
  const [addons, setAddons] = useState<CompanyAddonEntitlement[]>([]);

  useEffect(() => {
    if (!data) return;

    setTier(data.profile.plan_tier_code);
    setStatus(data.profile.billing_status);
    setCustomPricing(data.profile.custom_pricing_enabled);
    setMonthly(centsToDollars(data.profile.custom_monthly_price_cents));
    setSetup(centsToDollars(data.profile.custom_setup_price_cents));
    setNotes(data.profile.pricing_notes || '');
    setFeatures(data.features);
    setAddons(data.addons);
  }, [data]);

  async function handleSave() {
    if (!data) return;

    try {
      await save.mutateAsync({
        plan_tier_code: tier,
        billing_status: status,
        billing_interval: data.profile.billing_interval,
        custom_pricing_enabled: customPricing,
        custom_monthly_price_cents: customPricing ? dollarsToCents(monthly) : null,
        custom_setup_price_cents: customPricing ? dollarsToCents(setup) : null,
        annual_discount_bps: data.profile.annual_discount_bps || 0,
        contract_start_date: data.profile.contract_start_date,
        contract_end_date: data.profile.contract_end_date,
        pricing_notes: notes,
        feature_overrides: features.map((feature) => ({
          feature_code: feature.feature_code,
          enabled: feature.enabled,
          inclusion: feature.inclusion,
          notes: feature.notes || '',
        })),
        addons: addons.map((addon) => ({
          addon_code: addon.addon_code,
          enabled: addon.enabled,
          quantity: addon.quantity,
          monthly_price_cents: addon.monthly_price_cents,
          setup_price_cents: addon.setup_price_cents,
          usage_terms: addon.usage_terms || '',
          notes: addon.notes || '',
        })),
      });
      toast.success('Billing settings saved.');
      onSaved();
    } catch (saveError) {
      toast.error(String((saveError as Error).message || 'Could not save billing settings.'));
    }
  }

  return (
    <SlideOver
      open={open}
      title={data?.company.name || 'Client Billing'}
      description="Superadmin-only plan, pricing, feature, and add-on controls"
      onClose={onClose}
      widthClassName="max-w-5xl"
      actions={
        <Button disabled={!data || save.isPending} onClick={handleSave}>
          {save.isPending ? 'Saving...' : 'Save Billing'}
        </Button>
      }
    >
      {isLoading ? <div className="text-sm text-muted-foreground">Loading billing profile...</div> : null}
      {error ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {String((error as Error).message)}
        </div>
      ) : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Plan tier</span>
              <SelectInput
                aria-label="Plan tier"
                value={tier}
                onChange={(event) => setTier(event.target.value as PlanTierCode)}
              >
                {data.catalog.tiers.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.name}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Billing status</span>
              <SelectInput
                aria-label="Billing status"
                value={status}
                onChange={(event) => setStatus(event.target.value as BillingStatus)}
              >
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </SelectInput>
            </label>
            <div className="rounded-md border border-border px-4 py-3">
              <div className="text-xs text-muted-foreground">Monthly total</div>
              <div className="text-lg font-semibold">{money(data.effectiveMonthlyCents)}</div>
            </div>
            <div className="rounded-md border border-border px-4 py-3">
              <div className="text-xs text-muted-foreground">Setup total</div>
              <div className="text-lg font-semibold">{money(data.effectiveSetupCents)}</div>
            </div>
          </div>

          <section className="space-y-3 rounded-md border border-border p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={customPricing}
                aria-label="Custom pricing"
                onChange={(event) => setCustomPricing(event.target.checked)}
              />
              Custom pricing
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                aria-label="Custom monthly price"
                type="number"
                min="0"
                placeholder="Monthly dollars"
                value={monthly}
                disabled={!customPricing}
                onChange={(event) => setMonthly(event.target.value)}
              />
              <Input
                aria-label="Custom setup price"
                type="number"
                min="0"
                placeholder="Setup dollars"
                value={setup}
                disabled={!customPricing}
                onChange={(event) => setSetup(event.target.value)}
              />
              <Input
                aria-label="Pricing notes"
                placeholder="Pricing notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Add-ons</h3>
            <AddonChecklist addons={addons} onChange={setAddons} disabled={save.isPending} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Feature entitlements</h3>
            <FeatureMatrixTable catalog={data.catalog} editableFeatures={features} onChange={setFeatures} />
          </section>
        </div>
      ) : null}
    </SlideOver>
  );
}
