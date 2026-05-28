-- Security hardening: enable RLS on every public table and install default policies.
-- The backend uses the Supabase service role and bypasses RLS; these policies protect
-- direct anon/authenticated Data API access.

create or replace function public.auth_company_id_text()
returns text
language sql
stable
as $$
  select nullif(coalesce(
    auth.jwt() ->> 'activeCompanyId',
    auth.jwt() ->> 'companyId',
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id'
  ), '')
$$;

create or replace function public.auth_role_text()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() ->> 'role',
    auth.jwt() -> 'app_metadata' ->> 'role',
    ''
  )
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
  select public.auth_role_text() in ('superadmin', 'platform_admin', 'super_admin')
$$;

-- Waitlist remains public write-only for the landing page.
alter table if exists public.waitlist enable row level security;
drop policy if exists "waitlist: insert only" on public.waitlist;
create policy "waitlist: insert only"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);

-- Auth refresh sessions are backend-only even though they live in public for migrations.
alter table if exists public.auth_refresh_sessions enable row level security;
revoke all on public.auth_refresh_sessions from anon, authenticated;
drop policy if exists "auth_refresh_sessions: deny direct client access" on public.auth_refresh_sessions;
create policy "auth_refresh_sessions: deny direct client access"
  on public.auth_refresh_sessions
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Apply default tenant policies to every current public table.
do $$
declare
  table_record record;
  policy_name text;
begin
  for table_record in
    select c.relname as table_name,
           exists (
             select 1
             from information_schema.columns cols
             where cols.table_schema = 'public'
               and cols.table_name = c.relname
               and cols.column_name = 'company_id'
           ) as has_company_id
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'pg_%'
  loop
    execute format('alter table public.%I enable row level security', table_record.table_name);

    if table_record.table_name = 'waitlist' then
      continue;
    end if;

    if table_record.has_company_id then
      policy_name := table_record.table_name || ': tenant scoped';
      execute format('drop policy if exists %I on public.%I', policy_name, table_record.table_name);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_platform_admin() or company_id::text = public.auth_company_id_text()) with check (public.is_platform_admin() or company_id::text = public.auth_company_id_text())',
        policy_name,
        table_record.table_name
      );
    else
      policy_name := table_record.table_name || ': deny direct client access';
      execute format('drop policy if exists %I on public.%I', policy_name, table_record.table_name);
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
        policy_name,
        table_record.table_name
      );
    end if;
  end loop;
end $$;

-- Reinstall explicit self-service policies for users after the generic tenant sweep.
drop policy if exists "users: own tenant users" on public.users;
create policy "users: own tenant users"
  on public.users
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or company_id::text = public.auth_company_id_text()
    or id::text = auth.uid()::text
  );