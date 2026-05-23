-- Track asynchronous Stripe PaymentIntent reconciliation on invoices.
alter table if exists public.invoices
  add column if not exists payment_status text,
  add column if not exists payment_failed_at timestamptz,
  add column if not exists payment_failure_reason text,
  add column if not exists stripe_payment_intent_id text;

create index if not exists invoices_stripe_payment_intent_id_idx
  on public.invoices(stripe_payment_intent_id);
