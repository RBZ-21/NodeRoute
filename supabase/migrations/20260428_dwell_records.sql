-- Persist stop dwell times (arrive/depart events) so stop duration
-- calculations survive server restarts. Previously stored in-memory only.
create table if not exists public.dwell_records (
  id          text        primary key,
  stop_id     text        not null,
  route_id    text        not null default '',
  driver_id   text        not null default '',
  arrived_at  timestamptz not null,
  departed_at timestamptz,
  dwell_ms    bigint,
  created_at  timestamptz not null default now()
);

create index if not exists idx_dwell_records_stop_id  on public.dwell_records(stop_id);
create index if not exists idx_dwell_records_route_id on public.dwell_records(route_id);
