-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260420_location_scope
-- Purpose  : Extend multi-company support into true operating locations.
--            Adds a normalized locations table plus per-user location scope and
--            location defaults on the main operational tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Locations master table
create table if not exists public.locations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  slug          text,
  code          text,
  kind          text not null default 'warehouse',
  address       text,
  city          text,
  state         text,
  postal_code   text,
  country       text default 'US',
  timezone      text default 'America/New_York',
  is_active     boolean not null default true,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (company_id, slug)
);

comment on table public.locations is
  'Physical operating locations for a company such as warehouses, hubs, or branches.';

comment on column public.locations.kind is
  'Examples: warehouse, branch, hub, kitchen, office.';

-- 2. Seed the default location for the seeded default company
insert into public.locations (
  id,
  company_id,
  name,
  slug,
  code,
  kind,
  timezone
)
values (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'Primary Location',
  'primary-location',
  'PRIMARY',
  'warehouse',
  'America/New_York'
)
on conflict (id) do nothing;

-- 3. Users: operating scope fields
alter table public.users
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists accessible_location_ids uuid[] default '{}'::uuid[],
  add column if not exists platform_role text;

comment on column public.users.location_id is
  'Default active operating location for this user.';

comment on column public.users.accessible_location_ids is
  'Explicit list of locations this user can operate in.';

comment on column public.users.platform_role is
  'Optional cross-company role such as platform_admin for operators managing multiple companies.';

-- 4. Add location scope to the highest-impact operational tables
alter table public.orders
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.invoices
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.seafood_inventory
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.inventory_stock_history
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.inventory_yield_log
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.inventory_lots
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.purchase_orders
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.stops
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.routes
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.driver_locations
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.portal_contacts
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null;

-- 5. Backfill to the default location for all existing single-location data
update public.users
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101'),
  accessible_location_ids = case
    when accessible_location_ids is null or cardinality(accessible_location_ids) = 0
      then array['00000000-0000-0000-0000-000000000101'::uuid]
    else accessible_location_ids
  end
where
  company_id is null
  or location_id is null
  or accessible_location_ids is null
  or cardinality(accessible_location_ids) = 0;

update public.orders
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.invoices
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.seafood_inventory
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.inventory_stock_history
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.inventory_yield_log
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.inventory_lots
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.purchase_orders
set
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where location_id is null;

update public.stops
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.routes
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.driver_locations
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

alter table public.driver_locations
  drop constraint if exists driver_locations_driver_name_key;

update public.portal_contacts
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

update public.portal_contacts
set id = gen_random_uuid()
where id is null;

alter table public.portal_contacts
  drop constraint if exists portal_contacts_pkey;

alter table public.portal_contacts
  alter column id set not null;

alter table public.portal_contacts
  add primary key (id);

-- 6. Default values for legacy insert paths that have not been scoped yet
alter table public.users
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101',
  alter column accessible_location_ids set default array['00000000-0000-0000-0000-000000000101'::uuid];

alter table public.orders
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.invoices
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.seafood_inventory
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.inventory_stock_history
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.inventory_yield_log
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.inventory_lots
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.purchase_orders
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.stops
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.routes
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.driver_locations
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

alter table public.portal_contacts
  alter column company_id set default '00000000-0000-0000-0000-000000000001',
  alter column location_id set default '00000000-0000-0000-0000-000000000101';

-- 7. Helpful indexes for scoped reads
create index if not exists idx_locations_company on public.locations(company_id);
create index if not exists idx_users_location on public.users(location_id);
create index if not exists idx_orders_location on public.orders(location_id);
create index if not exists idx_invoices_location on public.invoices(location_id);
create index if not exists idx_inventory_location on public.seafood_inventory(location_id);
create index if not exists idx_inv_hist_location on public.inventory_stock_history(location_id);
create index if not exists idx_inv_yield_location on public.inventory_yield_log(location_id);
create index if not exists idx_lots_location on public.inventory_lots(location_id);
create index if not exists idx_po_location on public.purchase_orders(location_id);
create index if not exists idx_stops_location on public.stops(location_id);
create index if not exists idx_routes_location on public.routes(location_id);
create index if not exists idx_driver_locations_location on public.driver_locations(location_id);
create unique index if not exists idx_driver_locations_company_driver_name
  on public.driver_locations(company_id, driver_name);
create unique index if not exists idx_portal_contacts_company_email
  on public.portal_contacts(company_id, email);
create index if not exists idx_portal_contacts_company on public.portal_contacts(company_id);
create index if not exists idx_portal_contacts_location on public.portal_contacts(location_id);
