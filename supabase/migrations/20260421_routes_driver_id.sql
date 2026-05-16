-- Preserve route/driver assignment distinction for newer deployments.
-- Older route tables may only have a driver display-name column.

alter table if exists public.routes
  add column if not exists driver_id text;

create index if not exists idx_routes_driver_id on public.routes(driver_id);
