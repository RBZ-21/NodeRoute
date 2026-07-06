-- -----------------------------------------------------------------------------
-- Migration: 20260706130000_repair_orders_stop_id_uuid
-- Purpose  : Repair production drift where 20260527_orders_stop_id won before
--            removal and left public.orders.stop_id as text instead of uuid.
--
--            Fresh environments already get stop_id from
--            20260519000300_orders_stop_id_fk.sql as uuid references stops(id).
--            This file intentionally does not add a second stop_id column
--            definition; it only repairs existing drifted databases.
-- -----------------------------------------------------------------------------

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
declare
  stop_id_type text;
begin
  select c.udt_name
  into stop_id_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'orders'
    and c.column_name = 'stop_id';

  if stop_id_type is null then
    raise exception 'public.orders.stop_id is missing; expected base migration 20260519000300_orders_stop_id_fk to create it';
  elsif stop_id_type <> 'uuid' then
    update public.orders
    set stop_id = null
    where stop_id is not null
      and btrim(stop_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    update public.orders o
    set stop_id = null
    where o.stop_id is not null
      and btrim(o.stop_id::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and not exists (
        select 1
        from public.stops s
        where s.id = btrim(o.stop_id::text)::uuid
      );

    alter table public.orders
      alter column stop_id drop default,
      alter column stop_id type uuid using nullif(btrim(stop_id::text), '')::uuid;
  end if;
end$$;

update public.orders o
set stop_id = null
where o.stop_id is not null
  and not exists (
    select 1
    from public.stops s
    where s.id = o.stop_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.orders'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.stops'::regclass
      and a.attname = 'stop_id'
  ) then
    alter table public.orders
      add constraint orders_stop_id_fkey
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
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_stop_id_fkey'
      and not convalidated
  ) then
    alter table public.orders
      validate constraint orders_stop_id_fkey;
  end if;
end$$;

create index if not exists idx_orders_stop_id
  on public.orders(stop_id);

reset statement_timeout;
reset lock_timeout;
