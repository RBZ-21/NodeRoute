alter table public.driver_locations
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_driver_locations_user_id
  on public.driver_locations(user_id);
