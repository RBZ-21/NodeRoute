-- Security hardening: persisted refresh-token rotation and tenant query indexes.

create table if not exists public.auth_refresh_sessions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references public.auth_refresh_sessions(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.auth_refresh_sessions enable row level security;

revoke all on public.auth_refresh_sessions from anon, authenticated;

drop policy if exists "deny client refresh session reads" on public.auth_refresh_sessions;
create policy "deny client refresh session reads"
  on public.auth_refresh_sessions
  for select
  to anon, authenticated
  using (false);

drop policy if exists "deny client refresh session writes" on public.auth_refresh_sessions;
create policy "deny client refresh session writes"
  on public.auth_refresh_sessions
  for all
  to anon, authenticated
  using (false)
  with check (false);

create unique index if not exists idx_auth_refresh_sessions_token_hash
  on public.auth_refresh_sessions(token_hash);
create index if not exists idx_auth_refresh_sessions_user_active
  on public.auth_refresh_sessions(user_id, expires_at)
  where revoked_at is null;
create index if not exists idx_orders_company_created_at
  on public.orders(company_id, created_at desc);
create index if not exists idx_orders_company_route_id
  on public.orders(company_id, route_id);
create index if not exists idx_routes_company_created_at
  on public.routes(company_id, created_at desc);
create index if not exists idx_stops_company_created_at
  on public.stops(company_id, created_at desc);
create index if not exists idx_driver_locations_company_user_updated
  on public.driver_locations(company_id, user_id, updated_at desc);
create index if not exists idx_users_company_role_status
  on public.users(company_id, role, status);