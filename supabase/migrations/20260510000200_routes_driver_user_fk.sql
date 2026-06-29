-- Link persisted route assignments to real user accounts.
-- Cleans up any orphaned legacy driver_id values before adding the FK.

alter table if exists public.routes
  add column if not exists driver_id text;

update public.routes as route
set driver_id = null
where route.driver_id is not null
  and not exists (
    select 1
    from public.users as user_account
    where user_account.id = route.driver_id
  );

create index if not exists idx_routes_driver_id on public.routes(driver_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'routes_driver_id_fkey'
      and conrelid = 'public.routes'::regclass
  ) then
    alter table public.routes
      add constraint routes_driver_id_fkey
      foreign key (driver_id)
      references public.users(id)
      on delete set null;
  end if;
end
$$;
