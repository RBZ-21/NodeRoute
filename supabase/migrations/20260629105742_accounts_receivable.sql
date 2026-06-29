-- Phase 6: accounts receivable ledger, receipts, finance charges, tax tracking.
-- Supabase CLI was unavailable in the local environment, so this timestamped
-- migration was created manually.

create extension if not exists pgcrypto;

alter table public."Customers"
  add column if not exists credit_hold_threshold numeric(12,4);

create table if not exists public.ar_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  entry_type text not null check (entry_type in ('invoice', 'payment', 'credit_memo', 'finance_charge', 'adjustment')),
  reference_id text,
  reference_type text,
  amount numeric(12,4) not null default 0,
  balance_after numeric(12,4) not null default 0,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  receipt_date date not null default current_date,
  total_amount numeric(12,4) not null check (total_amount >= 0),
  unapplied_amount numeric(12,4) not null default 0 check (unapplied_amount >= 0),
  payment_method text not null check (payment_method in ('cash', 'check', 'card', 'credit_memo', 'unapplied')),
  check_number text,
  stripe_payment_intent_id text,
  idempotency_key text,
  status text not null default 'new' check (status in ('new', 'applied', 'partially_applied', 'unapplied', 'void')),
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_receipt_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  cash_receipt_id uuid not null references public.cash_receipts(id) on delete cascade,
  invoice_id text not null,
  applied_amount numeric(12,4) not null check (applied_amount > 0),
  applied_at timestamptz not null default now(),
  constraint cash_receipt_applications_receipt_invoice_key unique (cash_receipt_id, invoice_id)
);

create table if not exists public.finance_charge_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  run_date date not null,
  mode text not null check (mode in ('preview', 'committed')),
  status text not null default 'preview' check (status in ('preview', 'committed', 'failed')),
  total_charges numeric(12,4) not null default 0,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_charge_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  finance_charge_run_id uuid not null references public.finance_charge_runs(id) on delete cascade,
  customer_id text not null,
  invoice_id text not null,
  days_overdue int not null check (days_overdue >= 0),
  charge_amount numeric(12,4) not null check (charge_amount >= 0),
  constraint finance_charge_entries_run_invoice_key unique (finance_charge_run_id, invoice_id)
);

create table if not exists public.sales_tax_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  rate numeric(6,4) not null check (rate >= 0),
  state_code text,
  county text,
  city text,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_tax_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  invoice_id text not null,
  jurisdiction_id uuid references public.sales_tax_jurisdictions(id) on delete set null,
  taxable_amount numeric(12,4) not null default 0,
  tax_amount numeric(12,4) not null default 0,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_credit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  event_type text not null check (event_type in ('auto_hold', 'manual_hold', 'manual_release', 'threshold_change')),
  old_status text,
  new_status text,
  triggered_by text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists ar_ledger_entries_customer_idx
  on public.ar_ledger_entries(company_id, location_id, customer_id, entry_date desc, created_at desc);
create unique index if not exists ar_ledger_entries_reference_once_idx
  on public.ar_ledger_entries(company_id, entry_type, reference_type, reference_id)
  where reference_id is not null;

create index if not exists cash_receipts_customer_idx
  on public.cash_receipts(company_id, location_id, customer_id, receipt_date desc);
create unique index if not exists cash_receipts_stripe_payment_intent_idx
  on public.cash_receipts(company_id, stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create unique index if not exists cash_receipts_idempotency_key_idx
  on public.cash_receipts(company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists cash_receipt_applications_receipt_idx
  on public.cash_receipt_applications(company_id, location_id, cash_receipt_id);
create index if not exists cash_receipt_applications_invoice_idx
  on public.cash_receipt_applications(company_id, location_id, invoice_id);

create unique index if not exists finance_charge_runs_committed_once_idx
  on public.finance_charge_runs(company_id, location_id, run_date)
  where mode = 'committed';
create index if not exists finance_charge_entries_run_idx
  on public.finance_charge_entries(company_id, location_id, finance_charge_run_id);

create index if not exists sales_tax_jurisdictions_scope_idx
  on public.sales_tax_jurisdictions(company_id, location_id, state_code, county, city);
create index if not exists sales_tax_entries_invoice_idx
  on public.sales_tax_entries(company_id, location_id, invoice_id);
create index if not exists customer_credit_events_customer_idx
  on public.customer_credit_events(company_id, location_id, customer_id, created_at desc);

alter table public.ar_ledger_entries enable row level security;
alter table public.cash_receipts enable row level security;
alter table public.cash_receipt_applications enable row level security;
alter table public.finance_charge_runs enable row level security;
alter table public.finance_charge_entries enable row level security;
alter table public.sales_tax_jurisdictions enable row level security;
alter table public.sales_tax_entries enable row level security;
alter table public.customer_credit_events enable row level security;

grant select, insert, update, delete on public.ar_ledger_entries to authenticated;
grant select, insert, update, delete on public.cash_receipts to authenticated;
grant select, insert, update, delete on public.cash_receipt_applications to authenticated;
grant select, insert, update, delete on public.finance_charge_runs to authenticated;
grant select, insert, update, delete on public.finance_charge_entries to authenticated;
grant select, insert, update, delete on public.sales_tax_jurisdictions to authenticated;
grant select, insert, update, delete on public.sales_tax_entries to authenticated;
grant select, insert, update, delete on public.customer_credit_events to authenticated;

drop policy if exists "ar_ledger_entries tenant scoped" on public.ar_ledger_entries;
create policy "ar_ledger_entries tenant scoped"
  on public.ar_ledger_entries
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "cash_receipts tenant scoped" on public.cash_receipts;
create policy "cash_receipts tenant scoped"
  on public.cash_receipts
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "cash_receipt_applications tenant scoped" on public.cash_receipt_applications;
create policy "cash_receipt_applications tenant scoped"
  on public.cash_receipt_applications
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "finance_charge_runs tenant scoped" on public.finance_charge_runs;
create policy "finance_charge_runs tenant scoped"
  on public.finance_charge_runs
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "finance_charge_entries tenant scoped" on public.finance_charge_entries;
create policy "finance_charge_entries tenant scoped"
  on public.finance_charge_entries
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "sales_tax_jurisdictions tenant scoped" on public.sales_tax_jurisdictions;
create policy "sales_tax_jurisdictions tenant scoped"
  on public.sales_tax_jurisdictions
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "sales_tax_entries tenant scoped" on public.sales_tax_entries;
create policy "sales_tax_entries tenant scoped"
  on public.sales_tax_entries
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "customer_credit_events tenant scoped" on public.customer_credit_events;
create policy "customer_credit_events tenant scoped"
  on public.customer_credit_events
  for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));
