import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import type { CompanySettings } from '../hooks/useSettings';

export type InvoiceSettingKey =
  | 'invoiceAddress'
  | 'invoicePhone'
  | 'invoiceFax'
  | 'invoiceAfterHoursPhone'
  | 'invoiceRemitTo'
  | 'invoiceSalesTerms'
  | 'invoiceCreditTerms'
  | 'invoiceCopyLabel'
  | 'invoiceSafetyNotice';

type Props = {
  values: CompanySettings;
  disabled: boolean;
  onChange: (field: InvoiceSettingKey, value: string) => void;
};

const contactInputs: Array<{ field: InvoiceSettingKey; label: string; placeholder: string }> = [
  { field: 'invoicePhone', label: 'Invoice phone', placeholder: '(843) 577-3531' },
  { field: 'invoiceFax', label: 'Fax', placeholder: '(843) 722-2445' },
  { field: 'invoiceAfterHoursPhone', label: 'After-hours phone', placeholder: '(843) 723-1278' },
  { field: 'invoiceCopyLabel', label: 'Copy label', placeholder: 'CUSTOMER COPY' },
  { field: 'invoiceSafetyNotice', label: 'Safety notice', placeholder: 'ALL SEAFOOD SHOULD BE FULLY COOKED' },
];

const documentTextareas: Array<{ field: InvoiceSettingKey; label: string; placeholder: string; rows: number }> = [
  { field: 'invoiceAddress', label: 'Invoice address', placeholder: 'Street address\nCity, State ZIP', rows: 3 },
  { field: 'invoiceRemitTo', label: 'Remit-to address', placeholder: 'Payment mailing address', rows: 3 },
  { field: 'invoiceSalesTerms', label: 'Sales terms', placeholder: 'Terms shown at the bottom of the invoice', rows: 5 },
  { field: 'invoiceCreditTerms', label: 'Credit terms', placeholder: 'Credit and collection terms shown at the bottom of the invoice', rows: 5 },
];

export function InvoiceSettingsFields({ values, disabled, onChange }: Props) {
  return (
    <div className="space-y-4 border-y border-border py-4">
      <div>
        <div className="text-sm font-semibold text-foreground">Invoice contact and remit-to</div>
        <div className="mt-1 text-xs text-muted-foreground">Printed in the invoice header and payment section.</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {contactInputs.map(({ field, label, placeholder }) => (
          <label key={field} className="space-y-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
            <Input
              aria-label={label}
              value={String(values[field] || '')}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(event) => onChange(field, event.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {documentTextareas.map(({ field, label, placeholder, rows }) => (
          <label key={field} className="space-y-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
            <Textarea
              aria-label={label}
              value={String(values[field] || '')}
              placeholder={placeholder}
              rows={rows}
              disabled={disabled}
              onChange={(event) => onChange(field, event.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
