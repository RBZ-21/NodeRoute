-- Sprint 2: warehouse foundation, vendor bills, and tenant RLS hardening.
-- Notes:
-- - New public tables include explicit grants because Supabase Data API grants
--   are independent from RLS.
-- - Policies use app_metadata/custom JWT company/location claims when present.
--   Backend service-role access is unaffected by RLS.

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.jwt_company_id()
returns uuid
language sql
stable
as $$
  select nullif(coalesce(
    auth.jwt() ->> 'activeCompanyId',
    auth.jwt() ->> 'companyId',
    auth.jwt() ->> 'company_id'
  ), '')::uuid
$$;

create or replace function public.jwt_location_id()
returns uuid
language sql
stable
as $$
  select nullif(coalesce(
    auth.jwt() ->> 'activeLocationId',
    auth.jwt() ->> 'locationId',
    auth.jwt() ->> 'location_id'
  ), '')::uuid
$$;

create or replace function public.row_company_allowed(row_company_id uuid)
returns boolean
language sql
stable
as $$
  select row_company_id is null
    or (
      public.jwt_company_id() is not null
      and row_company_id = public.jwt_company_id()
    )
$$;

create or replace function public.row_location_allowed(row_location_id uuid)
returns boolean
language sql
stable
as $$
  select row_location_id is null
    or (
      public.jwt_location_id() is not null
      and row_location_id = public.jwt_location_id()
    )
$$;

-- ── Missing legacy foundation tables ────────────────────────────────────────

create table if not exists public.vendors (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default '00000000-0000-0000-0000-000000000001'
                references public.companies(id) on delete cascade,
  location_id   uuid default '00000000-0000-0000-0000-000000000101'
                references public.locations(id) on delete set null,
  name          text not null,
  contact       text,
  email         text,
  phone         text,
  category      text,
  status        text not null default 'active',
  address       text,
  notes         text,
  payment_terms text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.lot_codes (
  id                serial primary key,
  company_id        uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.companies(id) on delete cascade,
  location_id       uuid default '00000000-0000-0000-0000-000000000101'
                    references public.locations(id) on delete set null,
  lot_number        text not null unique,
  product_id        text,
  vendor_id         text,
  quantity_received numeric(10,3) not null default 0 check (quantity_received >= 0),
  unit_of_measure   text not null default 'lb',
  received_date     date not null default current_date,
  received_by       text,
  expiration_date   date,
  notes             text,
  created_at        timestamptz not null default now()
);

-- ── Warehouse tables ────────────────────────────────────────────────────────

create table if not exists public.warehouse_locations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default '00000000-0000-0000-0000-000000000001'
              references public.companies(id) on delete cascade,
  location_id uuid default '00000000-0000-0000-0000-000000000101'
              references public.locations(id) on delete set null,
  name        text not null,
  type        text not null,
  status      text not null default 'active',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.warehouse_locations
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.warehouse_locations
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table public.warehouse_locations
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101',
  alter column company_id set not null;

create table if not exists public.warehouse_scans (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default '00000000-0000-0000-0000-000000000001'
              references public.companies(id) on delete cascade,
  location_id uuid default '00000000-0000-0000-0000-000000000101'
              references public.locations(id) on delete set null,
  item_number text not null,
  action      text not null check (action in ('scan', 'receive', 'pick', 'adjust', 'transfer')),
  quantity    numeric,
  unit        text,
  warehouse_location_id uuid references public.warehouse_locations(id) on delete set null,
  lot_number  text,
  notes       text,
  performed_by text,
  created_at  timestamptz not null default now()
);

alter table public.warehouse_scans
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists warehouse_location_id uuid references public.warehouse_locations(id) on delete set null,
  add column if not exists performed_by text,
  add column if not exists created_at timestamptz not null default now();

update public.warehouse_scans
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table public.warehouse_scans
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101',
  alter column company_id set not null;

create table if not exists public.warehouse_returns (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default '00000000-0000-0000-0000-000000000001'
                   references public.companies(id) on delete cascade,
  location_id      uuid default '00000000-0000-0000-0000-000000000101'
                   references public.locations(id) on delete set null,
  customer_id      text,
  customer_name    text,
  item_number      text not null,
  item_description text,
  quantity         numeric not null check (quantity > 0),
  unit             text,
  reason           text not null,
  lot_number       text,
  notes            text,
  status           text not null default 'open'
                   check (status in ('open', 'reviewing', 'resolved', 'rejected')),
  resolution       text,
  restocked        boolean not null default false,
  reported_by      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.warehouse_returns
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists resolution text,
  add column if not exists restocked boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.warehouse_returns
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table public.warehouse_returns
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101',
  alter column company_id set not null;

create table if not exists public.vendor_bills (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.companies(id) on delete cascade,
  location_id       uuid default '00000000-0000-0000-0000-000000000101'
                    references public.locations(id) on delete set null,
  vendor_id         uuid references public.vendors(id) on delete set null,
  vendor_name       text,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  bill_number       text,
  bill_date         date,
  due_date          date,
  subtotal          numeric not null default 0,
  tax               numeric not null default 0,
  total             numeric not null default 0 check (total >= 0),
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'disputed', 'paid', 'void')),
  items             jsonb not null default '[]'::jsonb,
  notes             text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.vendor_bills
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null,
  add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.vendor_bills
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table public.vendor_bills
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101',
  alter column company_id set not null;

-- ── Scope legacy traceability tables ────────────────────────────────────────

alter table if exists public.lot_codes
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null;

update public.lot_codes
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table if exists public.lot_codes
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table if exists public."Customers"
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null;

update public."Customers"
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table if exists public."Customers"
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table if exists public.dwell_records
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null;

update public.dwell_records
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table if exists public.dwell_records
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table if exists public.vendors
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists contact text,
  add column if not exists category text,
  add column if not exists status text not null default 'active',
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists payment_terms text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.vendors
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table if exists public.vendors
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101',
  alter column company_id set not null;

-- ── Indexes ────────────────────────────────────────────────────────────────

create index if not exists idx_warehouse_locations_scope on public.warehouse_locations(company_id, location_id, status);
create index if not exists idx_warehouse_scans_scope_created on public.warehouse_scans(company_id, location_id, created_at desc);
create index if not exists idx_warehouse_scans_item_created on public.warehouse_scans(item_number, created_at desc);
create index if not exists idx_warehouse_returns_scope_status on public.warehouse_returns(company_id, location_id, status);
create index if not exists idx_vendor_bills_scope_status on public.vendor_bills(company_id, location_id, status);
create index if not exists idx_vendor_bills_vendor on public.vendor_bills(vendor_id, created_at desc);
create index if not exists idx_vendors_scope_status on public.vendors(company_id, location_id, status);
create index if not exists idx_lot_codes_scope on public.lot_codes(company_id, location_id);
create index if not exists idx_customers_scope on public."Customers"(company_id, location_id);
create index if not exists idx_dwell_records_scope on public.dwell_records(company_id, location_id);

-- ── updated_at trigger ─────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_warehouse_locations_updated_at on public.warehouse_locations;
create trigger trg_warehouse_locations_updated_at
  before update on public.warehouse_locations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_warehouse_returns_updated_at on public.warehouse_returns;
create trigger trg_warehouse_returns_updated_at
  before update on public.warehouse_returns
  for each row execute function public.set_updated_at();

drop trigger if exists trg_vendor_bills_updated_at on public.vendor_bills;
create trigger trg_vendor_bills_updated_at
  before update on public.vendor_bills
  for each row execute function public.set_updated_at();

drop trigger if exists trg_vendors_updated_at on public.vendors;
create trigger trg_vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.warehouse_locations enable row level security;
alter table public.warehouse_scans enable row level security;
alter table public.warehouse_returns enable row level security;
alter table public.vendor_bills enable row level security;
alter table if exists public.vendors enable row level security;
alter table if exists public.lot_codes enable row level security;
alter table if exists public."Customers" enable row level security;
alter table if exists public.dwell_records enable row level security;

drop policy if exists "tenant scoped warehouse locations" on public.warehouse_locations;
create policy "tenant scoped warehouse locations"
  on public.warehouse_locations
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped warehouse scans" on public.warehouse_scans;
create policy "tenant scoped warehouse scans"
  on public.warehouse_scans
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped warehouse returns" on public.warehouse_returns;
create policy "tenant scoped warehouse returns"
  on public.warehouse_returns
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped vendor bills" on public.vendor_bills;
create policy "tenant scoped vendor bills"
  on public.vendor_bills
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped vendors" on public.vendors;
create policy "tenant scoped vendors"
  on public.vendors
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped lot codes" on public.lot_codes;
create policy "tenant scoped lot codes"
  on public.lot_codes
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped customers" on public."Customers";
create policy "tenant scoped customers"
  on public."Customers"
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped dwell records" on public.dwell_records;
create policy "tenant scoped dwell records"
  on public.dwell_records
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

-- Explicit grants for Data API exposure when project defaults do not auto-grant.
grant select, insert, update, delete on public.warehouse_locations to authenticated;
grant select, insert, update, delete on public.warehouse_scans to authenticated;
grant select, insert, update, delete on public.warehouse_returns to authenticated;
grant select, insert, update, delete on public.vendor_bills to authenticated;
grant select, insert, update, delete on public.vendors to authenticated;
grant select, insert, update, delete on public.lot_codes to authenticated;
grant usage, select on sequence public.lot_codes_id_seq to authenticated;
grant select, insert, update, delete on public."Customers" to authenticated;
grant select, insert, update, delete on public.dwell_records to authenticated;
