import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceSettingsFields } from './InvoiceSettingsFields';

describe('InvoiceSettingsFields', () => {
  it('shows the approved editable invoice fields and reports changes', () => {
    const onChange = vi.fn();

    render(
      <InvoiceSettingsFields
        values={{
          invoicePhone: '(843) 577-3531',
          invoiceSafetyNotice: 'ALL SEAFOOD SHOULD BE FULLY COOKED',
        }}
        disabled={false}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Invoice phone'), {
      target: { value: '(843) 555-0100' },
    });

    expect(screen.getByLabelText('Invoice address')).toBeInTheDocument();
    expect(screen.getByLabelText('Remit-to address')).toBeInTheDocument();
    expect(screen.getByLabelText('Sales terms')).toBeInTheDocument();
    expect(screen.getByLabelText('Credit terms')).toBeInTheDocument();
    expect(screen.getByLabelText('Safety notice')).toHaveValue('ALL SEAFOOD SHOULD BE FULLY COOKED');
    expect(onChange).toHaveBeenCalledWith('invoicePhone', '(843) 555-0100');
  });

  it('disables every field when company settings are read-only', () => {
    render(
      <InvoiceSettingsFields
        values={{}}
        disabled
        onChange={() => {}}
      />,
    );

    for (const control of screen.getAllByRole('textbox')) {
      expect(control).toBeDisabled();
    }
  });
});
