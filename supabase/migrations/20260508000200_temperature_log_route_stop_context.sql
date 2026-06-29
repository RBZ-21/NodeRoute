alter table if exists public.temperature_logs
  add column if not exists route_id text,
  add column if not exists stop_id text;

create index if not exists idx_temperature_logs_route_id
  on public.temperature_logs(route_id, logged_at desc);

create index if not exists idx_temperature_logs_stop_id
  on public.temperature_logs(stop_id, logged_at desc);
