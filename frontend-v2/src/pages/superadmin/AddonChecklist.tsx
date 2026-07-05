import type { CompanyAddonEntitlement } from './billing-types';
import { Input } from '../../components/ui/input';

function dollars(cents: number | null | undefined) {
  if (cents == null) return 'Quote';
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo`;
}

export function AddonChecklist({
  addons,
  disabled = false,
  onChange,
}: {
  addons: CompanyAddonEntitlement[];
  disabled?: boolean;
  onChange: (addons: CompanyAddonEntitlement[]) => void;
}) {
  function patch(addonCode: string, update: Partial<CompanyAddonEntitlement>) {
    onChange(addons.map((addon) => addon.addon_code === addonCode ? { ...addon, ...update } : addon));
  }

  return (
    <div className="divide-y rounded-md border border-border">
      {addons.map((addon) => {
        const label = addon.addon?.name || addon.addon_code;
        return (
          <label key={addon.addon_code} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center">
            <span className="flex min-w-0 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-input"
                checked={addon.enabled}
                disabled={disabled}
                aria-label={label}
                onChange={(event) => patch(addon.addon_code, { enabled: event.target.checked })}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{addon.usage_terms || addon.addon?.usage_terms || dollars(addon.monthly_price_cents)}</span>
              </span>
            </span>
            <Input
              type="number"
              min="0"
              step="1"
              value={addon.quantity}
              disabled={disabled || !addon.enabled}
              aria-label={`${label} quantity`}
              onChange={(event) => patch(addon.addon_code, { quantity: Number(event.target.value || 0) })}
            />
            <Input
              type="number"
              min="0"
              step="1"
              value={addon.monthly_price_cents == null ? '' : Math.round(addon.monthly_price_cents / 100)}
              disabled={disabled || !addon.enabled}
              aria-label={`${label} monthly price`}
              placeholder="Quote"
              onChange={(event) => patch(addon.addon_code, {
                monthly_price_cents: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100),
              })}
            />
          </label>
        );
      })}
    </div>
  );
}
