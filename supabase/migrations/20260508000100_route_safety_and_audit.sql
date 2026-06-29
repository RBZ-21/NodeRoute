alter table if exists public.stops
  add column if not exists route_id text,
  add column if not exists stop_seq integer;

create index if not exists idx_stops_route_id on public.stops(route_id);

create unique index if not exists idx_stops_route_stop_seq_unique
  on public.stops(route_id, stop_seq)
  where route_id is not null and stop_seq is not null;

create table if not exists public.route_mutation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  location_id uuid,
  route_id text not null,
  action text not null,
  actor_user_id text,
  actor_email text,
  actor_role text,
  before_stop_ids jsonb not null default '[]'::jsonb,
  after_stop_ids jsonb not null default '[]'::jsonb,
  before_active_stop_ids jsonb not null default '[]'::jsonb,
  after_active_stop_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_route_mutation_audit_logs_route_id
  on public.route_mutation_audit_logs(route_id, created_at desc);

alter table public.route_mutation_audit_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'route_mutation_audit_logs'
      and policyname = 'Allow all for authenticated'
  ) then
    create policy "Allow all for authenticated"
      on public.route_mutation_audit_logs
      for all
      using (true);
  end if;
end $$;
