create extension if not exists pgcrypto;

alter table if exists public.vendors
  add column if not exists min_order_value numeric(12,4),
  add column if not exists pallet_qty numeric(12,4),
  add column if not exists layer_qty numeric(12,4),
  add column if not exists lead_time_days integer,
  add column if not exists seasonal_usage_windows jsonb not null default '[]'::jsonb;

create table if not exists public.ap_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  entry_type text not null check (entry_type in ('bill', 'payment', 'credit_memo', 'adjustment')),
  reference_id uuid,
  reference_type text,
  amount numeric(12,4) not null default 0,
  balance_after numeric(12,4) not null default 0,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.ap_payment_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  payment_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'void')),
  total_amount numeric(12,4) not null default 0,
  payment_method text not null default 'check' check (payment_method in ('check', 'ach', 'wire', 'card', 'cash', 'other')),
  bank_account_id uuid,
  approved_by text references public.users(id) on delete set null,
  approved_at timestamptz,
  paid_by text references public.users(id) on delete set null,
  paid_at timestamptz,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ap_payment_batch_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  ap_payment_batch_id uuid not null references public.ap_payment_batches(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_bill_id uuid references public.vendor_bills(id) on delete set null,
  amount numeric(12,4) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  account_name text not null,
  account_type text not null default 'checking' check (account_type in ('checking', 'savings', 'credit', 'cash', 'other')),
  institution_name text,
  last_four text,
  routing_last_four text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  opening_balance numeric(12,4) not null default 0,
  current_balance numeric(12,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ap_payment_batches_bank_account_fk'
      and conrelid = 'public.ap_payment_batches'::regclass
  ) then
    alter table public.ap_payment_batches
      add constraint ap_payment_batches_bank_account_fk
      foreign key (bank_account_id)
      references public.bank_accounts(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.bank_reconciliation_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  statement_start_date date,
  statement_end_date date not null,
  statement_balance numeric(12,4) not null default 0,
  status text not null default 'open' check (status in ('open', 'completed')),
  completed_by text references public.users(id) on delete set null,
  completed_at timestamptz,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  bank_reconciliation_session_id uuid not null references public.bank_reconciliation_sessions(id) on delete cascade,
  ap_ledger_entry_id uuid references public.ap_ledger_entries(id) on delete set null,
  external_reference text,
  description text,
  amount numeric(12,4) not null default 0,
  cleared boolean not null default false,
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_requirements_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  as_of_date date not null default current_date,
  horizon_days integer not null default 30 check (horizon_days >= 0),
  total_due numeric(12,4) not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ap_ledger_scope_vendor_date
  on public.ap_ledger_entries(company_id, location_id, vendor_id, entry_date desc);
create unique index if not exists idx_ap_ledger_reference_once
  on public.ap_ledger_entries(company_id, entry_type, reference_type, reference_id)
  where reference_id is not null and reference_type is not null;
create index if not exists idx_ap_payment_batches_scope_status
  on public.ap_payment_batches(company_id, location_id, status, payment_date desc);
create index if not exists idx_ap_payment_batch_items_batch
  on public.ap_payment_batch_items(ap_payment_batch_id);
create index if not exists idx_bank_accounts_scope_status
  on public.bank_accounts(company_id, location_id, status);
create index if not exists idx_bank_reconciliation_sessions_account
  on public.bank_reconciliation_sessions(bank_account_id, statement_end_date desc);
create index if not exists idx_cash_requirements_snapshots_scope_date
  on public.cash_requirements_snapshots(company_id, location_id, as_of_date desc);

alter table public.ap_ledger_entries enable row level security;
alter table public.ap_payment_batches enable row level security;
alter table public.ap_payment_batch_items enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_reconciliation_sessions enable row level security;
alter table public.bank_reconciliation_items enable row level security;
alter table public.cash_requirements_snapshots enable row level security;

drop policy if exists "tenant scoped ap ledger entries" on public.ap_ledger_entries;
create policy "tenant scoped ap ledger entries"
  on public.ap_ledger_entries
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped ap payment batches" on public.ap_payment_batches;
create policy "tenant scoped ap payment batches"
  on public.ap_payment_batches
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped ap payment batch items" on public.ap_payment_batch_items;
create policy "tenant scoped ap payment batch items"
  on public.ap_payment_batch_items
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped bank accounts" on public.bank_accounts;
create policy "tenant scoped bank accounts"
  on public.bank_accounts
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped bank reconciliation sessions" on public.bank_reconciliation_sessions;
create policy "tenant scoped bank reconciliation sessions"
  on public.bank_reconciliation_sessions
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped bank reconciliation items" on public.bank_reconciliation_items;
create policy "tenant scoped bank reconciliation items"
  on public.bank_reconciliation_items
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped cash requirements snapshots" on public.cash_requirements_snapshots;
create policy "tenant scoped cash requirements snapshots"
  on public.cash_requirements_snapshots
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

grant select, insert, update, delete on public.ap_ledger_entries to authenticated;
grant select, insert, update, delete on public.ap_payment_batches to authenticated;
grant select, insert, update, delete on public.ap_payment_batch_items to authenticated;
grant select, insert, update, delete on public.bank_accounts to authenticated;
grant select, insert, update, delete on public.bank_reconciliation_sessions to authenticated;
grant select, insert, update, delete on public.bank_reconciliation_items to authenticated;
grant select, insert, update, delete on public.cash_requirements_snapshots to authenticated;
