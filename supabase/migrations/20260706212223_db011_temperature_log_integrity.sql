-- -----------------------------------------------------------------------------
-- Migration: 20260706212223_db011_temperature_log_integrity
-- Finding  : DB-011 (Root Depth Scan, commit 904d7119)
-- Purpose  : Require recorder attribution on temperature logs and attach route
--            and stop context to their UUID parents.
--
--            Live-verified state at fix time (2026-07-06):
--              temperature_logs.recorded_by = text nullable
--              temperature_logs.initials    = text nullable
--              temperature_logs.route_id    = missing live; text in repo history
--              temperature_logs.stop_id     = missing live; text in repo history
--              routes.id and stops.id       = uuid
--
--            Existing rows are backfilled/null-repaired before constraints are
--            tightened. FKs are added NOT VALID first, then validated, matching
--            the guarded repair pattern used by recent FK migrations.
-- -----------------------------------------------------------------------------

set lock_timeout = '5s';
set statement_timeout = '2min';

alter table if exists public.temperature_logs
  add column if not exists recorded_by text,
  add column if not exists initials text;

update public.temperature_logs
set recorded_by = 'unknown'
where recorded_by is null or btrim(recorded_by) = '';

update public.temperature_logs
set initials = 'unknown'
where initials is null or btrim(initials) = '';

alter table public.temperature_logs
  alter column recorded_by set not null,
  alter column initials set not null;

do $$
declare
  route_id_type text;
begin
  select c.udt_name
  into route_id_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'temperature_logs'
    and c.column_name = 'route_id';

  if route_id_type is null then
    alter table public.temperature_logs
      add column route_id uuid;
  elsif route_id_type <> 'uuid' then
    update public.temperature_logs
    set route_id = null
    where route_id is not null
      and btrim(route_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    update public.temperature_logs tl
    set route_id = null
    where tl.route_id is not null
      and btrim(tl.route_id::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and not exists (
        select 1
        from public.routes r
        where r.id = btrim(tl.route_id::text)::uuid
      );

    alter table public.temperature_logs
      alter column route_id drop default,
      alter column route_id type uuid using nullif(btrim(route_id::text), '')::uuid;
  end if;
end$$;

update public.temperature_logs tl
set route_id = null
where tl.route_id is not null
  and not exists (
    select 1
    from public.routes r
    where r.id = tl.route_id
  );

do $$
declare
  stop_id_type text;
begin
  select c.udt_name
  into stop_id_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'temperature_logs'
    and c.column_name = 'stop_id';

  if stop_id_type is null then
    alter table public.temperature_logs
      add column stop_id uuid;
  elsif stop_id_type <> 'uuid' then
    update public.temperature_logs
    set stop_id = null
    where stop_id is not null
      and btrim(stop_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    update public.temperature_logs tl
    set stop_id = null
    where tl.stop_id is not null
      and btrim(tl.stop_id::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and not exists (
        select 1
        from public.stops s
        where s.id = btrim(tl.stop_id::text)::uuid
      );

    alter table public.temperature_logs
      alter column stop_id drop default,
      alter column stop_id type uuid using nullif(btrim(stop_id::text), '')::uuid;
  end if;
end$$;

update public.temperature_logs tl
set stop_id = null
where tl.stop_id is not null
  and not exists (
    select 1
    from public.stops s
    where s.id = tl.stop_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.temperature_logs'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.routes'::regclass
      and a.attname = 'route_id'
  ) then
    alter table public.temperature_logs
      add constraint temperature_logs_route_id_fkey
      foreign key (route_id)
      references public.routes(id)
      on delete set null
      not valid;
  end if;
end$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.temperature_logs'::regclass
      and conname = 'temperature_logs_route_id_fkey'
      and not convalidated
  ) then
    alter table public.temperature_logs
      validate constraint temperature_logs_route_id_fkey;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.temperature_logs'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.stops'::regclass
      and a.attname = 'stop_id'
  ) then
    alter table public.temperature_logs
      add constraint temperature_logs_stop_id_fkey
      foreign key (stop_id)
      references public.stops(id)
      on delete set null
      not valid;
  end if;
end$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.temperature_logs'::regclass
      and conname = 'temperature_logs_stop_id_fkey'
      and not convalidated
  ) then
    alter table public.temperature_logs
      validate constraint temperature_logs_stop_id_fkey;
  end if;
end$$;

create index if not exists idx_temperature_logs_route_id
  on public.temperature_logs(route_id, logged_at desc);

create index if not exists idx_temperature_logs_stop_id
  on public.temperature_logs(stop_id, logged_at desc);

reset statement_timeout;
reset lock_timeout;
