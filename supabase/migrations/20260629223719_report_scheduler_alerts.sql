-- Phase 8: named report definitions, scheduled deliveries, and operational alerts.

create extension if not exists pgcrypto;

create table if not exists public.report_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.companies(id) on delete cascade,
  location_id uuid default '00000000-0000-0000-0000-000000000101' references public.locations(id) on delete set null,
  name text not null,
  category text not null default 'General',
  description text,
  query_key text not null,
  parameters jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_definitions_query_key_not_blank check (length(trim(query_key)) > 0),
  constraint report_definitions_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  report_definition_id uuid not null references public.report_definitions(id) on delete cascade,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  cadence_config jsonb not null default '{}'::jsonb,
  delivery_targets jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  report_schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  run_key text not null unique,
  period_start date not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'delivered', 'skipped', 'failed')),
  delivered_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.report_delivery_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  report_schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  target_type text not null check (target_type in ('email', 'download')),
  address text,
  created_at timestamptz not null default now(),
  constraint report_delivery_target_address_required check (target_type <> 'email' or length(trim(coalesce(address, ''))) > 0)
);

create table if not exists public.inventory_alert_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  product_id uuid references public.products(id) on delete cascade,
  category_id text,
  rule_type text not null check (rule_type in ('low_stock', 'out_of_stock')),
  threshold numeric(12,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_alert_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text,
  rule_type text not null check (rule_type in ('approaching_limit', 'over_limit')),
  threshold_pct numeric(6,2) not null default 90 check (threshold_pct >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alert_sends (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  rule_id uuid not null,
  entity_id text not null,
  alert_type text not null,
  sent_at timestamptz not null default now()
);

create unique index if not exists report_definitions_company_query_key_idx
  on public.report_definitions(company_id, query_key);
create index if not exists report_definitions_category_idx
  on public.report_definitions(company_id, category, name);
create index if not exists report_schedules_due_idx
  on public.report_schedules(company_id, location_id, is_active, next_run_at);
create index if not exists report_runs_schedule_idx
  on public.report_runs(company_id, location_id, report_schedule_id, period_start desc);
create index if not exists report_delivery_targets_schedule_idx
  on public.report_delivery_targets(company_id, location_id, report_schedule_id);
create index if not exists inventory_alert_rules_scope_idx
  on public.inventory_alert_rules(company_id, location_id, is_active, rule_type);
create index if not exists credit_alert_rules_scope_idx
  on public.credit_alert_rules(company_id, location_id, is_active, rule_type);
create unique index if not exists alert_sends_cooldown_lookup_idx
  on public.alert_sends(company_id, rule_id, entity_id, alert_type, sent_at desc);

insert into public.report_definitions (company_id, location_id, name, category, description, query_key, parameters, is_system)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Chain Store Report', 'Sales', 'Customer sales grouped for chain-store review.', 'chain_store', '{}'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Commodity Report', 'Inventory', 'Sales and quantities by commodity or category.', 'commodity', '{}'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Gross Profit Report', 'Analytics', 'Revenue, estimated cost, and gross profit by item.', 'gross_profit', '{}'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Invoice Register', 'Financials', 'Invoice totals, balances, dates, and status.', 'invoice_register', '{}'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Tonnage Report', 'Operations', 'Pounds and tons shipped by product.', 'tonnage', '{}'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Comparative Sales Report', 'Analytics', 'Current period sales compared with the prior period.', 'comparative_sales', '{}'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Price Exceptions Report', 'Pricing', 'Invoices and order lines with pricing exceptions.', 'price_exceptions', '{}'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'Weekly Projections Report', 'Planning', 'Projected weekly demand and low-stock exposure.', 'weekly_projections', '{}'::jsonb, true)
on conflict (company_id, query_key) do update
set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  parameters = excluded.parameters,
  is_system = excluded.is_system,
  updated_at = now();

alter table public.report_definitions enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_runs enable row level security;
alter table public.report_delivery_targets enable row level security;
alter table public.inventory_alert_rules enable row level security;
alter table public.credit_alert_rules enable row level security;
alter table public.alert_sends enable row level security;

grant select, insert, update, delete on public.report_definitions to authenticated;
grant select, insert, update, delete on public.report_schedules to authenticated;
grant select, insert, update, delete on public.report_runs to authenticated;
grant select, insert, update, delete on public.report_delivery_targets to authenticated;
grant select, insert, update, delete on public.inventory_alert_rules to authenticated;
grant select, insert, update, delete on public.credit_alert_rules to authenticated;
grant select, insert, update, delete on public.alert_sends to authenticated;

drop policy if exists "report_definitions tenant scoped" on public.report_definitions;
create policy "report_definitions tenant scoped"
  on public.report_definitions
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "report_schedules tenant scoped" on public.report_schedules;
create policy "report_schedules tenant scoped"
  on public.report_schedules
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "report_runs tenant scoped" on public.report_runs;
create policy "report_runs tenant scoped"
  on public.report_runs
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "report_delivery_targets tenant scoped" on public.report_delivery_targets;
create policy "report_delivery_targets tenant scoped"
  on public.report_delivery_targets
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "inventory_alert_rules tenant scoped" on public.inventory_alert_rules;
create policy "inventory_alert_rules tenant scoped"
  on public.inventory_alert_rules
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "credit_alert_rules tenant scoped" on public.credit_alert_rules;
create policy "credit_alert_rules tenant scoped"
  on public.credit_alert_rules
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "alert_sends tenant scoped" on public.alert_sends;
create policy "alert_sends tenant scoped"
  on public.alert_sends
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));
