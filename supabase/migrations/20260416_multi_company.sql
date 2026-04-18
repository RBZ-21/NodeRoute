-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260416_multi_company
-- Purpose  : Add company isolation to every data table.
--            All existing rows are assigned to a default "seed" company so the
--            app continues to work without any data loss.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Companies master table
create table if not exists companies (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        unique,
  plan        text        not null default 'starter',  -- starter | pro | enterprise
  settings    jsonb       not null default '{}',
  created_at  timestamptz not null default now()
);

-- 2. Seed the default company (fixed UUID so backend can reference it)
insert into companies (id, name, slug, plan)
values ('00000000-0000-0000-0000-000000000001', 'Default Company', 'default', 'starter')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add company_id to every data table
-- ─────────────────────────────────────────────────────────────────────────────

alter table users
  add column if not exists company_id uuid references companies(id) on delete set null;

alter table seafood_inventory
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table inventory_stock_history
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table inventory_yield_log
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table orders
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table invoices
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table stops
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table routes
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table "250 restaurants"
  add column if not exists company_id uuid references companies(id) on delete cascade;

alter table driver_locations
  add column if not exists company_id uuid references companies(id) on delete cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill all existing rows → default company
-- ─────────────────────────────────────────────────────────────────────────────

update users               set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update seafood_inventory   set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update inventory_stock_history set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update inventory_yield_log set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update orders              set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update invoices            set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update stops               set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update routes              set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update "250 restaurants"   set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update driver_locations    set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Indexes for fast per-company lookups
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists idx_users_company           on users(company_id);
create index if not exists idx_inventory_company       on seafood_inventory(company_id);
create index if not exists idx_inv_hist_company        on inventory_stock_history(company_id);
create index if not exists idx_inv_yield_company       on inventory_yield_log(company_id);
create index if not exists idx_orders_company          on orders(company_id);
create index if not exists idx_invoices_company        on invoices(company_id);
create index if not exists idx_stops_company           on stops(company_id);
create index if not exists idx_routes_company          on routes(company_id);
create index if not exists idx_driver_loc_company      on driver_locations(company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Also update the admin user to be role 'admin' on the default company
--    (idempotent — only touches rows that exist)
-- ─────────────────────────────────────────────────────────────────────────────

update users
  set company_id = '00000000-0000-0000-0000-000000000001'
  where id = 'admin-001' and company_id is null;
