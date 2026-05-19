-- Align invoice status constraint with application-supported AR and delivery states.
alter table if exists public.invoices
  drop constraint if exists invoices_status_check;

alter table if exists public.invoices
  add constraint invoices_status_check
  check (
    status in (
      'pending',
      'in_process',
      'processed',
      'invoiced',
      'signed',
      'sent',
      'delivered',
      'overdue',
      'paid',
      'void',
      'cancelled',
      'canceled'
    )
  );
