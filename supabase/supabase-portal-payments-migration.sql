-- Portal Payments (Debit + ACH) schema
-- Run this migration in Supabase SQL editor before enabling payment profiles/autopay in production.

create table if not exists public.portal_payment_methods (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  company_id uuid null,
  location_id uuid null,
  provider text not null default 'manual',
  method_type text not null check (method_type in ('debit_card', 'ach_bank')),
  label text null,
  payment_method_ref text not null,
  is_default boolean not null default false,
  status text not null default 'active',
  brand text null,
  last4 text null,
  exp_month int null,
  exp_year int null,
  bank_name text null,
  account_last4 text null,
  routing_last4 text null,
  account_type text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_portal_payment_methods_email on public.portal_payment_methods (customer_email);
create index if not exists idx_portal_payment_methods_scope on public.portal_payment_methods (company_id, location_id);

create table if not exists public.portal_payment_settings (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  company_id uuid null,
  location_id uuid null,
  autopay_enabled boolean not null default false,
  method_id uuid null references public.portal_payment_methods(id) on delete set null,
  autopay_day_of_month int not null default 1,
  max_amount numeric(12,2) null,
  last_run_at timestamptz null,
  next_run_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_portal_payment_settings_email_scope
  on public.portal_payment_settings (customer_email, company_id, location_id);

create table if not exists public.portal_payment_events (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  company_id uuid null,
  location_id uuid null,
  event_type text not null,
  amount numeric(12,2) not null default 0,
  currency text not null default 'usd',
  method_id uuid null references public.portal_payment_methods(id) on delete set null,
  method_type text null,
  provider text null,
  status text not null default 'queued',
  message text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_portal_payment_events_email on public.portal_payment_events (customer_email, created_at desc);
