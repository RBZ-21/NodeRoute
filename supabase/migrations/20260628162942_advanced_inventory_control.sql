-- Phase 3: advanced inventory control foundations.

alter table if exists public.products
  add column if not exists real_cost numeric(12,4),
  add column if not exists landed_cost numeric(12,4),
  add column if not exists base_cost numeric(12,4),
  add column if not exists lot_cost numeric(12,4),
  add column if not exists market_cost numeric(12,4);

alter table if exists public.inventory_lots
  add column if not exists real_cost numeric(12,4),
  add column if not exists landed_cost numeric(12,4),
  add column if not exists base_cost numeric(12,4),
  add column if not exists lot_cost numeric(12,4),
  add column if not exists market_cost numeric(12,4),
  add column if not exists warehouse_location_id uuid references public.warehouse_locations(id) on delete set null;

alter table if exists public.inventory_stock_history
  add column if not exists cost_basis numeric(12,4),
  add column if not exists uom text,
  add column if not exists conversion_factor numeric(12,6),
  add column if not exists ledger_ref text;

alter table if exists public.purchase_orders
  add column if not exists scheduled_receipt_date date;

create table if not exists public.inventory_uom_conversions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  product_id uuid references public.products(id) on delete cascade,
  from_uom text not null,
  to_uom text not null,
  factor numeric(12,6) not null,
  created_at timestamptz not null default now(),
  constraint inventory_uom_conversions_factor_chk check (factor > 0),
  constraint inventory_uom_conversions_key unique (company_id, product_id, from_uom, to_uom)
);

create table if not exists public.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  status text not null default 'open',
  started_by text references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint cycle_counts_status_chk check (status in ('open', 'submitted', 'completed', 'cancelled'))
);

create table if not exists public.cycle_count_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  cycle_count_id uuid not null references public.cycle_counts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  lot_id uuid references public.inventory_lots(id) on delete set null,
  warehouse_location_id uuid references public.warehouse_locations(id) on delete set null,
  expected_qty numeric(12,4) not null default 0,
  counted_qty numeric(12,4),
  variance_qty numeric(12,4),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.kit_recipes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  output_product_id uuid references public.products(id) on delete restrict,
  output_qty numeric(12,4) not null,
  output_uom text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint kit_recipes_output_qty_chk check (output_qty > 0)
);

create table if not exists public.kit_recipe_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  kit_recipe_id uuid not null references public.kit_recipes(id) on delete cascade,
  input_product_id uuid references public.products(id) on delete restrict,
  input_lot_id uuid references public.inventory_lots(id) on delete set null,
  input_qty numeric(12,4) not null,
  input_uom text not null,
  created_at timestamptz not null default now(),
  constraint kit_recipe_items_input_qty_chk check (input_qty > 0)
);

create table if not exists public.kit_processing_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  kit_recipe_id uuid references public.kit_recipes(id) on delete set null,
  run_date date not null default current_date,
  quantity_produced numeric(12,4) not null,
  status text not null default 'completed',
  ledger_group_id uuid not null default gen_random_uuid(),
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint kit_processing_runs_qty_chk check (quantity_produced > 0),
  constraint kit_processing_runs_status_chk check (status in ('completed', 'failed'))
);

create table if not exists public.inventory_shortages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  lot_id uuid references public.inventory_lots(id) on delete set null,
  shortage_qty numeric(12,4) not null,
  reason text,
  adjusted_by text references public.users(id) on delete set null,
  adjusted_at timestamptz not null default now(),
  constraint inventory_shortages_qty_chk check (shortage_qty > 0)
);

create table if not exists public.inventory_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  order_id uuid,
  product_id uuid references public.products(id) on delete set null,
  lot_id uuid references public.inventory_lots(id) on delete set null,
  return_qty numeric(12,4) not null,
  return_uom text not null,
  condition text,
  restocked boolean not null default false,
  restocked_at timestamptz,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_returns_qty_chk check (return_qty > 0)
);

create index if not exists inventory_uom_conversions_scope_idx on public.inventory_uom_conversions(company_id, location_id);
create index if not exists cycle_counts_scope_idx on public.cycle_counts(company_id, location_id, status);
create index if not exists cycle_count_items_count_idx on public.cycle_count_items(cycle_count_id);
create index if not exists kit_recipes_scope_idx on public.kit_recipes(company_id, location_id, is_active);
create index if not exists kit_recipe_items_recipe_idx on public.kit_recipe_items(kit_recipe_id);
create index if not exists kit_processing_runs_scope_idx on public.kit_processing_runs(company_id, location_id, run_date);
create index if not exists inventory_shortages_scope_idx on public.inventory_shortages(company_id, location_id, adjusted_at);
create index if not exists inventory_returns_scope_idx on public.inventory_returns(company_id, location_id, created_at);

alter table public.inventory_uom_conversions enable row level security;
alter table public.cycle_counts enable row level security;
alter table public.cycle_count_items enable row level security;
alter table public.kit_recipes enable row level security;
alter table public.kit_recipe_items enable row level security;
alter table public.kit_processing_runs enable row level security;
alter table public.inventory_shortages enable row level security;
alter table public.inventory_returns enable row level security;

drop policy if exists "tenant scoped inventory uom conversions" on public.inventory_uom_conversions;
create policy "tenant scoped inventory uom conversions"
  on public.inventory_uom_conversions
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped cycle counts" on public.cycle_counts;
create policy "tenant scoped cycle counts"
  on public.cycle_counts
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped cycle count items" on public.cycle_count_items;
create policy "tenant scoped cycle count items"
  on public.cycle_count_items
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped kit recipes" on public.kit_recipes;
create policy "tenant scoped kit recipes"
  on public.kit_recipes
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped kit recipe items" on public.kit_recipe_items;
create policy "tenant scoped kit recipe items"
  on public.kit_recipe_items
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped kit processing runs" on public.kit_processing_runs;
create policy "tenant scoped kit processing runs"
  on public.kit_processing_runs
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped inventory shortages" on public.inventory_shortages;
create policy "tenant scoped inventory shortages"
  on public.inventory_shortages
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped inventory returns" on public.inventory_returns;
create policy "tenant scoped inventory returns"
  on public.inventory_returns
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

grant select, insert, update, delete on public.inventory_uom_conversions to authenticated;
grant select, insert, update, delete on public.cycle_counts to authenticated;
grant select, insert, update, delete on public.cycle_count_items to authenticated;
grant select, insert, update, delete on public.kit_recipes to authenticated;
grant select, insert, update, delete on public.kit_recipe_items to authenticated;
grant select, insert, update, delete on public.kit_processing_runs to authenticated;
grant select, insert, update, delete on public.inventory_shortages to authenticated;
grant select, insert, update, delete on public.inventory_returns to authenticated;
