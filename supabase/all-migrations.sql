-- ================================================================
-- BASE TABLES
-- These tables are prerequisites for all migrations below.
-- ================================================================

-- portal_contacts (base)
CREATE TABLE IF NOT EXISTS portal_contacts (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  phone      TEXT,
  address    TEXT,
  company    TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- orders (base)
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text not null,
  customer_name    text not null,
  customer_email   text,
  customer_address text,
  items            jsonb default '[]'::jsonb,
  status           text not null default 'pending' check (status in ('pending','in_process','processed','invoiced')),
  driver_name      text,
  route_id         uuid,
  notes            text,
  created_at       timestamptz default now()
);
alter table orders enable row level security;
create policy "Allow all for authenticated" on orders for all using (true);

-- stops (base)
CREATE TABLE IF NOT EXISTS stops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  lat        NUMERIC DEFAULT 0,
  lng        NUMERIC DEFAULT 0,
  notes      TEXT DEFAULT '',
  door_code  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- routes (base)
CREATE TABLE IF NOT EXISTS routes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  stop_ids   UUID[] DEFAULT '{}',
  driver     TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- invoices (base)
create table if not exists invoices (
  id                 uuid        primary key default gen_random_uuid(),
  invoice_number     text        not null,
  customer_name      text        not null,
  customer_email     text,
  customer_address   text,
  billing_name       text,
  billing_contact    text,
  billing_email      text,
  billing_phone      text,
  billing_address    text,
  items              jsonb       not null default '[]'::jsonb,
  subtotal           numeric     not null default 0,
  tax                numeric     not null default 0,
  total              numeric     not null default 0,
  status             text        not null default 'pending'
                       check (status in ('pending','sent','signed','void')),
  driver_name        text,
  driver_id          text,
  notes              text,
  entree_invoice_id  text,
  signature_data     text,
  signed_at          timestamptz,
  sent_at            timestamptz,
  created_at         timestamptz not null default now()
);
alter table invoices enable row level security;
create policy "Allow all for authenticated" on invoices for all using (true);

-- Customers (base)
create table if not exists "Customers" (
  id              uuid        primary key default gen_random_uuid(),
  customer_number text,
  company_name    text        not null,
  phone_number    text,
  fax_number      text,
  contact_name    text,
  payment_terms   text,
  address         text,
  billing_name    text,
  billing_contact text,
  billing_email   text,
  billing_phone   text,
  billing_address text,
  tax_enabled     boolean     not null default false,
  created_at      timestamptz not null default now()
);
alter table "Customers" enable row level security;
create policy "Allow all for authenticated" on "Customers" for all using (true);

-- portal_contacts door_code column (added later in supabase-driver-migration.sql)
ALTER TABLE portal_contacts ADD COLUMN IF NOT EXISTS door_code TEXT;

-- portal payment tables
create table if not exists public.portal_payment_methods (
  id                 uuid primary key default gen_random_uuid(),
  customer_email     text not null,
  company_id         uuid null,
  location_id        uuid null,
  provider           text not null default 'manual',
  method_type        text not null check (method_type in ('debit_card', 'ach_bank')),
  label              text null,
  payment_method_ref text not null,
  is_default         boolean not null default false,
  status             text not null default 'active',
  brand              text null,
  last4              text null,
  exp_month          int null,
  exp_year           int null,
  bank_name          text null,
  account_last4      text null,
  routing_last4      text null,
  account_type       text null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_portal_payment_methods_email on public.portal_payment_methods (customer_email);
create index if not exists idx_portal_payment_methods_scope on public.portal_payment_methods (company_id, location_id);

create table if not exists public.portal_payment_settings (
  id                   uuid primary key default gen_random_uuid(),
  customer_email       text not null,
  company_id           uuid null,
  location_id          uuid null,
  autopay_enabled      boolean not null default false,
  method_id            uuid null references public.portal_payment_methods(id) on delete set null,
  autopay_day_of_month int not null default 1,
  max_amount           numeric(12,2) null,
  last_run_at          timestamptz null,
  next_run_at          timestamptz null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists idx_portal_payment_settings_email_scope
  on public.portal_payment_settings (customer_email, company_id, location_id);

create table if not exists public.portal_payment_events (
  id             uuid primary key default gen_random_uuid(),
  customer_email text not null,
  company_id     uuid null,
  location_id    uuid null,
  event_type     text not null,
  amount         numeric(12,2) not null default 0,
  currency       text not null default 'usd',
  method_id      uuid null references public.portal_payment_methods(id) on delete set null,
  method_type    text null,
  provider       text null,
  status         text not null default 'queued',
  message        text null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_portal_payment_events_email on public.portal_payment_events (customer_email, created_at desc);

-- ================================================================
-- 20260412_create_seafood_inventory.sql
-- ================================================================
create table if not exists public.seafood_inventory (
  item_number    text        primary key,
  description    text        not null,
  category       text        not null default 'Other',
  unit           text        not null default 'lb',
  cost           numeric     not null default 0,
  on_hand_qty    numeric     not null default 0,
  on_hand_weight numeric     not null default 0,
  lot_item       text        not null default 'N',
  created_at     timestamptz not null default now()
);

-- ================================================================
-- 20260413_create_users_table.sql
-- ================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT,
  role           TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('admin', 'manager', 'driver')),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending')),
  invite_token   TEXT,
  invite_expires TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON public.users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_invite_token_idx ON public.users (invite_token)
  WHERE invite_token IS NOT NULL;

-- ================================================================
-- 20260414_orders_charges.sql
-- ================================================================
alter table orders
  add column if not exists charges jsonb not null default '[]'::jsonb;

-- ================================================================
-- 20260414_tracking.sql
-- ================================================================
alter table orders
  add column if not exists tracking_token      text unique,
  add column if not exists tracking_expires_at timestamptz,
  add column if not exists customer_phone      text,
  add column if not exists customer_lat        numeric,
  add column if not exists customer_lng        numeric;

create table if not exists driver_locations (
  id          uuid primary key default gen_random_uuid(),
  driver_name text not null unique,
  lat         numeric not null default 32.7765,
  lng         numeric not null default -79.9311,
  heading     numeric default 0,
  speed_mph   numeric default 0,
  updated_at  timestamptz default now()
);
alter table driver_locations enable row level security;
create policy "Allow all for authenticated" on driver_locations
  for all using (true);

-- ================================================================
-- 20260415_inventory_enhancements.sql
-- ================================================================
alter table seafood_inventory
  add column if not exists avg_yield       numeric       default null,
  add column if not exists yield_count     integer       default 0,
  add column if not exists updated_at      timestamptz   default now(),
  add column if not exists alert_sent_at   timestamptz   default null;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_updated_at on seafood_inventory;
create trigger trg_inventory_updated_at
  before update on seafood_inventory
  for each row execute function set_updated_at();

create table if not exists inventory_stock_history (
  id          uuid        primary key default gen_random_uuid(),
  item_number text        not null,
  change_qty  numeric     not null,
  new_qty     numeric     not null,
  change_type text        not null default 'adjustment',
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_inv_hist_item_time on inventory_stock_history(item_number, created_at desc);
create index if not exists idx_inv_hist_type on inventory_stock_history(change_type);

create table if not exists inventory_yield_log (
  id            uuid        primary key default gen_random_uuid(),
  item_number   text        not null,
  raw_weight    numeric     not null,
  yield_weight  numeric     not null,
  yield_pct     numeric     not null,
  notes         text,
  logged_by     text,
  logged_at     timestamptz not null default now()
);
create index if not exists idx_inv_yield_item on inventory_yield_log(item_number, logged_at desc);

-- ================================================================
-- 20260416_multi_company.sql
-- ================================================================
create table if not exists companies (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        unique,
  plan        text        not null default 'starter',
  settings    jsonb       not null default '{}',
  created_at  timestamptz not null default now()
);
insert into companies (id, name, slug, plan)
values ('00000000-0000-0000-0000-000000000001', 'Default Company', 'default', 'starter')
on conflict (id) do nothing;

alter table users               add column if not exists company_id uuid references companies(id) on delete set null;
alter table seafood_inventory   add column if not exists company_id uuid references companies(id) on delete cascade;
alter table inventory_stock_history add column if not exists company_id uuid references companies(id) on delete cascade;
alter table inventory_yield_log add column if not exists company_id uuid references companies(id) on delete cascade;
alter table orders              add column if not exists company_id uuid references companies(id) on delete cascade;
alter table invoices            add column if not exists company_id uuid references companies(id) on delete cascade;
alter table stops               add column if not exists company_id uuid references companies(id) on delete cascade;
alter table routes              add column if not exists company_id uuid references companies(id) on delete cascade;
alter table driver_locations    add column if not exists company_id uuid references companies(id) on delete cascade;

update users               set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update seafood_inventory   set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update inventory_stock_history set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update inventory_yield_log set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update orders              set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update invoices            set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update stops               set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update routes              set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update driver_locations    set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;

create index if not exists idx_users_company        on users(company_id);
create index if not exists idx_inventory_company    on seafood_inventory(company_id);
create index if not exists idx_inv_hist_company     on inventory_stock_history(company_id);
create index if not exists idx_inv_yield_company    on inventory_yield_log(company_id);
create index if not exists idx_orders_company       on orders(company_id);
create index if not exists idx_invoices_company     on invoices(company_id);
create index if not exists idx_stops_company        on stops(company_id);
create index if not exists idx_routes_company       on routes(company_id);
create index if not exists idx_driver_loc_company   on driver_locations(company_id);

-- ================================================================
-- 20260417_inventory_lots.sql
-- ================================================================
create table if not exists inventory_lots (
  id                uuid         not null default gen_random_uuid() primary key,
  company_id        uuid         not null default '00000000-0000-0000-0000-000000000001' references companies(id) on delete cascade,
  item_number       text         not null,
  lot_number        text         not null,
  batch_number      text,
  supplier_name     text,
  country_of_origin text,
  received_date     date         not null default current_date,
  expiry_date       date,
  best_before_date  date,
  qty_received      numeric      not null default 0 check (qty_received >= 0),
  qty_on_hand       numeric      not null default 0 check (qty_on_hand >= 0),
  cost_per_unit     numeric               default 0,
  storage_temp      text,
  certifications    text,
  status            text         not null default 'active' check (status in ('active','depleted','expired','quarantine','recalled')),
  notes             text,
  created_by        text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);
alter table inventory_stock_history add column if not exists lot_id uuid references inventory_lots(id) on delete set null;

create index if not exists idx_inv_lots_expiry  on inventory_lots(expiry_date, status);
create index if not exists idx_inv_lots_item    on inventory_lots(item_number, status);
create index if not exists idx_inv_lots_company on inventory_lots(company_id, status);
create index if not exists idx_inv_lots_recent  on inventory_lots(created_at desc);

create or replace function set_inv_lot_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_inv_lot_updated_at on inventory_lots;
create trigger trg_inv_lot_updated_at
  before update on inventory_lots
  for each row execute function set_inv_lot_updated_at();

-- ================================================================
-- 20260419_purchase_orders.sql
-- ================================================================
create table if not exists purchase_orders (
  id             uuid        primary key default gen_random_uuid(),
  po_number      text,
  vendor         text,
  items          jsonb       not null default '[]',
  total_cost     numeric     not null default 0,
  notes          text,
  confirmed_by   text,
  scanned_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_po_created on purchase_orders(created_at desc);
create index if not exists idx_po_vendor  on purchase_orders(vendor);

-- ================================================================
-- 20260420_location_scope.sql
-- ================================================================
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
insert into public.locations (id, company_id, name, slug, code, kind, timezone)
values ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','Primary Location','primary-location','PRIMARY','warehouse','America/New_York')
on conflict (id) do nothing;

alter table public.users               add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.users               add column if not exists accessible_location_ids uuid[] default '{}'::uuid[];
alter table public.users               add column if not exists platform_role text;
alter table public.orders              add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.invoices            add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.seafood_inventory   add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.inventory_stock_history add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.inventory_yield_log add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.inventory_lots      add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.purchase_orders     add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.stops               add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.routes              add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.driver_locations    add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.portal_contacts     add column if not exists id uuid default gen_random_uuid();
alter table public.portal_contacts     add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.portal_contacts     add column if not exists location_id uuid references public.locations(id) on delete set null;

update public.users set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101'), accessible_location_ids = case when accessible_location_ids is null or cardinality(accessible_location_ids) = 0 then array['00000000-0000-0000-0000-000000000101'::uuid] else accessible_location_ids end where company_id is null or location_id is null or accessible_location_ids is null or cardinality(accessible_location_ids) = 0;
update public.orders set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.invoices set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.seafood_inventory set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.inventory_stock_history set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.inventory_yield_log set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.inventory_lots set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.purchase_orders set location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where location_id is null;
update public.stops set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.routes set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.driver_locations set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
alter table public.driver_locations drop constraint if exists driver_locations_driver_name_key;
update public.portal_contacts set company_id = coalesce(company_id,'00000000-0000-0000-0000-000000000001'), location_id = coalesce(location_id,'00000000-0000-0000-0000-000000000101') where company_id is null or location_id is null;
update public.portal_contacts set id = gen_random_uuid() where id is null;
alter table public.portal_contacts drop constraint if exists portal_contacts_pkey;
alter table public.portal_contacts alter column id set not null;
alter table public.portal_contacts add primary key (id);

alter table public.users               alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101', alter column accessible_location_ids set default array['00000000-0000-0000-0000-000000000101'::uuid];
alter table public.orders              alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.invoices            alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.seafood_inventory   alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.inventory_stock_history alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.inventory_yield_log alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.inventory_lots      alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.purchase_orders     alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.stops               alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.routes              alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.driver_locations    alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';
alter table public.portal_contacts     alter column company_id set default '00000000-0000-0000-0000-000000000001', alter column location_id set default '00000000-0000-0000-0000-000000000101';

create index if not exists idx_locations_company        on public.locations(company_id);
create index if not exists idx_users_location           on public.users(location_id);
create index if not exists idx_orders_location          on public.orders(location_id);
create index if not exists idx_invoices_location        on public.invoices(location_id);
create index if not exists idx_inventory_location       on public.seafood_inventory(location_id);
create index if not exists idx_inv_hist_location        on public.inventory_stock_history(location_id);
create index if not exists idx_inv_yield_location       on public.inventory_yield_log(location_id);
create index if not exists idx_lots_location            on public.inventory_lots(location_id);
create index if not exists idx_po_location              on public.purchase_orders(location_id);
create index if not exists idx_stops_location           on public.stops(location_id);
create index if not exists idx_routes_location          on public.routes(location_id);
create index if not exists idx_driver_locations_location on public.driver_locations(location_id);
create unique index if not exists idx_driver_locations_company_driver_name on public.driver_locations(company_id, driver_name);
create unique index if not exists idx_portal_contacts_company_email on public.portal_contacts(company_id, email);
create index if not exists idx_portal_contacts_company  on public.portal_contacts(company_id);
create index if not exists idx_portal_contacts_location on public.portal_contacts(location_id);

-- ================================================================
-- 20260421_customer_billing_info.sql
-- ================================================================
alter table if exists "Customers"
  add column if not exists billing_name    text,
  add column if not exists billing_contact text,
  add column if not exists billing_email   text,
  add column if not exists billing_phone   text,
  add column if not exists billing_address text;
alter table if exists invoices
  add column if not exists billing_name    text,
  add column if not exists billing_contact text,
  add column if not exists billing_email   text,
  add column if not exists billing_phone   text,
  add column if not exists billing_address text;

-- ================================================================
-- 20260421_inventory_notes.sql
-- ================================================================
alter table seafood_inventory
  add column if not exists notes text;

-- ================================================================
-- 20260421_order_tax_temperature_logs.sql
-- ================================================================
alter table if exists public."Customers"
  add column if not exists address     text,
  add column if not exists tax_enabled boolean not null default false;
alter table if exists public.orders
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists tax_rate    numeric not null default 0.09,
  add column if not exists invoice_id  text;
alter table if exists public.invoices
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists tax_rate    numeric not null default 0.09,
  add column if not exists order_id    text;

create table if not exists public.temperature_logs (
  id                uuid        primary key default gen_random_uuid(),
  company_id        uuid,
  location_id       uuid,
  logged_at         timestamptz not null default now(),
  storage_area      text        not null,
  temperature       numeric     not null,
  unit              text        not null default 'F',
  check_type        text        not null default 'routine',
  corrective_action text,
  initials          text,
  notes             text,
  recorded_by       text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_temperature_logs_logged_at on public.temperature_logs(logged_at desc);
create index if not exists idx_temperature_logs_location  on public.temperature_logs(location_id);
alter table public.temperature_logs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='temperature_logs' and policyname='Allow all for authenticated') then
    create policy "Allow all for authenticated" on public.temperature_logs for all using (true);
  end if;
end $$;

-- ================================================================
-- 20260421_routes_active_stops.sql
-- ================================================================
alter table if exists routes
  add column if not exists active_stop_ids jsonb default '[]'::jsonb;
update routes set active_stop_ids = to_jsonb(stop_ids)
where active_stop_ids = '[]'::jsonb and stop_ids is not null;

-- ================================================================
-- 20260421_routes_driver_id.sql
-- ================================================================
alter table if exists public.routes
  add column if not exists driver_id text;
create index if not exists idx_routes_driver_id on public.routes(driver_id);
