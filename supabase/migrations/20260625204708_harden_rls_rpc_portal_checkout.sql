-- Follow-up security hardening for direct Supabase Data API access.
-- The application backend uses the service_role key; these policies and grants
-- protect anon/authenticated clients if a browser or mobile client talks to
-- Supabase directly.

-- Never trust user-editable top-level JWT fields for tenant authorization.
-- Supabase Auth app_metadata is server-controlled and is the only accepted
-- source for tenant and app-role claims in RLS helpers.
create or replace function public.auth_company_id_text()
returns text
language sql
stable
set search_path = public, auth
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')
$$;

create or replace function public.auth_company_id()
returns uuid
language sql
stable
set search_path = public, auth
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid
$$;

create or replace function public.jwt_company_id()
returns uuid
language sql
stable
set search_path = public, auth
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid
$$;

create or replace function public.jwt_location_id()
returns uuid
language sql
stable
set search_path = public, auth
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'location_id', '')::uuid
$$;

create or replace function public.auth_role_text()
returns text
language sql
stable
set search_path = public, auth
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
set search_path = public, auth
as $$
  select public.auth_role_text() in ('superadmin', 'platform_admin', 'super_admin')
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
set search_path = public, auth
as $$
  select public.auth_role_text() in ('admin', 'manager', 'superadmin')
$$;

-- Remove historical policies that granted all authenticated users broad access.
-- Tenant-scoped policies installed by earlier migrations are left in place.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'waitlist'
      and (
        policyname = 'Allow all for authenticated'
        or policyname ilike '%tenant_isolation%'
        or coalesce(qual, '') in ('true', '(true)')
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

-- Reassert RLS for company_config. It has direct authenticated grants in older
-- migrations, so table-level RLS must be the protection boundary.
alter table if exists public.company_config enable row level security;
drop policy if exists "company_config: own company only" on public.company_config;
drop policy if exists "company_config: tenant scoped" on public.company_config;
drop policy if exists "company_config: tenant scoped authenticated" on public.company_config;
create policy "company_config: tenant scoped authenticated"
  on public.company_config
  for all
  to authenticated
  using (
    public.is_platform_admin()
    or company_id::text = public.auth_company_id_text()
  )
  with check (
    public.is_platform_admin()
    or company_id::text = public.auth_company_id_text()
  );

-- Keep the route-stop sync RPC as SECURITY DEFINER, but pin its search_path and
-- restrict EXECUTE so it cannot be called directly by anon/authenticated users.
create or replace function public.sync_route_stop_assignments(
  p_route_id text,
  p_stop_ids text[],
  p_active_stop_ids text[]
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_route_id uuid := p_route_id::uuid;
begin
  update public.stops s
  set stop_seq = -(sub.rn)::int
  from (
    select id, row_number() over (order by id) as rn
    from public.stops
    where route_id = v_route_id and stop_seq is not null
  ) sub
  where s.id = sub.id;

  update public.stops
  set route_id = null, stop_seq = null
  where route_id = v_route_id
    and id::text <> all(p_stop_ids);

  update public.stops
  set route_id = v_route_id,
      stop_seq  = pos.seq
  from (
    select
      unnest(p_active_stop_ids) as id,
      generate_subscripts(p_active_stop_ids, 1) as seq
  ) as pos
  where stops.id::text = pos.id;

  update public.stops
  set route_id = v_route_id,
      stop_seq  = null
  where id::text = any(p_stop_ids)
    and (id::text <> all(p_active_stop_ids) or array_length(p_active_stop_ids, 1) is null);
end;
$$;

revoke all on function public.sync_route_stop_assignments(text, text[], text[]) from public;
revoke all on function public.sync_route_stop_assignments(text, text[], text[]) from anon;
revoke all on function public.sync_route_stop_assignments(text, text[], text[]) from authenticated;
grant execute on function public.sync_route_stop_assignments(text, text[], text[]) to service_role;
