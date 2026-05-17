-- Harden backend-only tables that should never be directly accessible via
-- broad authenticated Supabase clients, and add tenant scope columns to
-- dwell_records so stop dwell telemetry can be filtered deterministically.

alter table if exists public.dwell_records
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null;

update public.dwell_records as dr
set
  company_id = coalesce(dr.company_id, s.company_id),
  location_id = coalesce(dr.location_id, s.location_id)
from public.stops as s
where s.id = dr.stop_id
  and (dr.company_id is null or dr.location_id is null);

update public.dwell_records as dr
set
  company_id = coalesce(dr.company_id, r.company_id),
  location_id = coalesce(dr.location_id, r.location_id)
from public.routes as r
where r.id = dr.route_id
  and (dr.company_id is null or dr.location_id is null);

create index if not exists idx_dwell_records_company_id
  on public.dwell_records(company_id);

create index if not exists idx_dwell_records_location_id
  on public.dwell_records(location_id);

alter table if exists public.driver_locations enable row level security;
drop policy if exists "Allow all for authenticated" on public.driver_locations;
drop policy if exists driver_locations_service_role_only on public.driver_locations;
create policy driver_locations_service_role_only
  on public.driver_locations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table if exists public.temperature_logs enable row level security;
drop policy if exists "Allow all for authenticated" on public.temperature_logs;
drop policy if exists temperature_logs_service_role_only on public.temperature_logs;
create policy temperature_logs_service_role_only
  on public.temperature_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table if exists public.route_mutation_audit_logs enable row level security;
drop policy if exists "Allow all for authenticated" on public.route_mutation_audit_logs;
drop policy if exists route_mutation_audit_logs_service_role_only on public.route_mutation_audit_logs;
create policy route_mutation_audit_logs_service_role_only
  on public.route_mutation_audit_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table if exists public.dwell_records enable row level security;
drop policy if exists "Allow all for authenticated" on public.dwell_records;
drop policy if exists dwell_records_service_role_only on public.dwell_records;
create policy dwell_records_service_role_only
  on public.dwell_records
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table if exists public.portal_challenges enable row level security;
drop policy if exists "Allow all for authenticated" on public.portal_challenges;
drop policy if exists portal_challenges_service_role_only on public.portal_challenges;
create policy portal_challenges_service_role_only
  on public.portal_challenges
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table if exists public.portal_auth_attempts enable row level security;
drop policy if exists "Allow all for authenticated" on public.portal_auth_attempts;
drop policy if exists portal_auth_attempts_service_role_only on public.portal_auth_attempts;
create policy portal_auth_attempts_service_role_only
  on public.portal_auth_attempts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
