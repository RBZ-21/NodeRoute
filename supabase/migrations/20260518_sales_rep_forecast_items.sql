-- Sales Rep Hub forecast inputs.
--
-- The /api/sales-reps/upsell-alerts endpoint reads forecast_items to compare
-- forecasted high-demand species against recent customer order history.

create table if not exists public.forecast_items (
  id uuid primary key default gen_random_uuid(),
  species text not null,
  projected_demand numeric not null default 0,
  unit text,
  forecast_date date not null default current_date,
  confidence numeric,
  source text,
  company_id uuid,
  location_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_forecast_items_scope
  on public.forecast_items(company_id, location_id);

create index if not exists idx_forecast_items_demand
  on public.forecast_items(projected_demand desc);

create index if not exists idx_forecast_items_species_date
  on public.forecast_items(species, forecast_date desc);

alter table public.forecast_items enable row level security;

drop policy if exists "forecast_items: tenant scoped" on public.forecast_items;
create policy "forecast_items: tenant scoped"
  on public.forecast_items
  for all
  to authenticated
  using (
    company_id is null
    or company_id = public.auth_company_id()
  )
  with check (
    company_id is null
    or company_id = public.auth_company_id()
  );

grant select, insert, update, delete on public.forecast_items to authenticated;
