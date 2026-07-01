import { useId } from 'react';
import { cn } from '../../lib/utils';
import { Input } from './input';

/**
 * DetailField — a label + view/edit row used in record detail panels.
 * Replaces the per-page `Field`/`InvoiceField` copies.
 *
 * `labelClassName` controls the label column width so a panel's fields stay
 * aligned with its other (non-DetailField) rows. Defaults to `w-32`.
 */
export function DetailField({
  label,
  value,
  editing,
  onChange,
  multiline,
  placeholder,
  labelClassName,
}: {
  label: string;
  value?: string | null;
  editing: boolean;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  labelClassName?: string;
}) {
  const inputId = useId();
  return (
    <div className="flex items-start gap-3">
      <label htmlFor={inputId} className={cn('shrink-0 pt-1 text-sm text-muted-foreground', labelClassName ?? 'w-32')}>{label}</label>
      {editing ? (
        multiline ? (
          <textarea
            id={inputId}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
        ) : (
          <Input id={inputId} className="flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        )
      ) : (
        <span className="text-sm">{value || '-'}</span>
      )}
    </div>
  );
}
