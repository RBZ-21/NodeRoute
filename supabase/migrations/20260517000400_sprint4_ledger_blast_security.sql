-- Sprint 4: tenant-scope stock ledger history used by inventory reads and SMS blasts.

alter table public.inventory_stock_history
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null;

update public.inventory_stock_history
set
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101')
where company_id is null or location_id is null;

create index if not exists idx_inv_hist_company_location
  on public.inventory_stock_history(company_id, location_id, created_at desc);

create or replace function public.jwt_company_id()
returns uuid
language sql
stable
as $$
  select nullif(coalesce(
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id'
  ), '')::uuid
$$;

create or replace function public.jwt_location_id()
returns uuid
language sql
stable
as $$
  select nullif(coalesce(
    auth.jwt() ->> 'location_id',
    auth.jwt() -> 'app_metadata' ->> 'location_id'
  ), '')::uuid
$$;

alter table public.inventory_stock_history enable row level security;

drop policy if exists "tenant scoped inventory stock history" on public.inventory_stock_history;
create policy "tenant scoped inventory stock history"
  on public.inventory_stock_history
  for all
  to authenticated
  using (
    (company_id is null or company_id = public.jwt_company_id())
    and (location_id is null or public.jwt_location_id() is null or location_id = public.jwt_location_id())
  )
  with check (
    (company_id is null or company_id = public.jwt_company_id())
    and (location_id is null or public.jwt_location_id() is null or location_id = public.jwt_location_id())
  );

grant select, insert, update, delete on public.inventory_stock_history to authenticated;
