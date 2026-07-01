import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * SelectInput — the native-`<select>` counterpart to `Input`. Use for plain
 * filter/form dropdowns; use the Radix `Select` (./select.tsx) when you need
 * a styled popover listbox.
 */
const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
SelectInput.displayName = 'SelectInput';

export { SelectInput };
