import { Input } from '../../components/ui/input';
import type { CompanyAddonEntitlement } from './billing-types';

function dollars(cents: number | null | undefined) {
  if (cents == null) return 'Quote';

  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo`;
}

type AddonChecklistProps = {
  addons: CompanyAddonEntitlement[];
  disabled?: boolean;
  onChange: (addons: CompanyAddonEntitlement[]) => void;
};

export function AddonChecklist({ addons, disabled = false, onChange }: AddonChecklistProps) {
  function patch(addonCode: string, update: Partial<CompanyAddonEntitlement>) {
    onChange(addons.map((addon) => (addon.addon_code === addonCode ? { ...addon, ...update } : addon)));
  }

  return (
    <ul className="divide-y rounded-md border border-border">
      {addons.map((addon) => {
        const label = addon.addon?.name || addon.addon_code;
        const supportText = addon.usage_terms || addon.addon?.usage_terms || dollars(addon.monthly_price_cents);
        const quantityId = `${addon.addon_code}-quantity`;
        const monthlyPriceId = `${addon.addon_code}-monthly-price`;

        return (
          <li
            key={addon.addon_code}
            className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center"
          >
            <label className="flex min-w-0 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={addon.enabled}
                disabled={disabled}
                onChange={(event) => patch(addon.addon_code, { enabled: event.target.checked })}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{supportText}</span>
              </span>
            </label>
            <div className="space-y-1 text-sm">
              <label htmlFor={quantityId} className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Quantity
              </label>
              <Input
                id={quantityId}
                type="number"
                min="0"
                step="1"
                value={addon.quantity}
                disabled={disabled || !addon.enabled}
                aria-label={`${label} quantity`}
                onChange={(event) => patch(addon.addon_code, { quantity: Number(event.target.value || 0) })}
              />
            </div>
            <div className="space-y-1 text-sm">
              <label htmlFor={monthlyPriceId} className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Monthly price
              </label>
              <Input
                id={monthlyPriceId}
                type="number"
                min="0"
                step="1"
                value={addon.monthly_price_cents == null ? '' : Math.round(addon.monthly_price_cents / 100)}
                disabled={disabled || !addon.enabled}
                placeholder="Quote"
                aria-label={`${label} monthly price`}
                onChange={(event) =>
                  patch(addon.addon_code, {
                    monthly_price_cents: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100),
                  })}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
