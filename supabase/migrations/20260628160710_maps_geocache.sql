-- Phase 2: Google Maps geocode and drive-time caches.

create table if not exists public.warehouse_geocodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  address_hash text not null,
  lat numeric not null,
  lng numeric not null,
  formatted_address text,
  geocoded_at timestamptz not null default now(),
  constraint warehouse_geocodes_lat_chk check (lat between -90 and 90),
  constraint warehouse_geocodes_lng_chk check (lng between -180 and 180),
  constraint warehouse_geocodes_location_hash_key unique (company_id, location_id, address_hash)
);

create table if not exists public.customer_geocodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  address_hash text not null,
  lat numeric not null,
  lng numeric not null,
  formatted_address text,
  geocoded_at timestamptz not null default now(),
  constraint customer_geocodes_lat_chk check (lat between -90 and 90),
  constraint customer_geocodes_lng_chk check (lng between -180 and 180),
  constraint customer_geocodes_customer_hash_key unique (company_id, customer_id, address_hash)
);

create table if not exists public.route_drive_time_cache (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  route_id text,
  origin_hash text not null,
  destination_hash text not null,
  travel_mode text not null,
  day_bucket date not null,
  duration_seconds int not null,
  distance_meters int not null,
  cached_at timestamptz not null default now(),
  constraint route_drive_time_cache_mode_chk check (travel_mode in ('driving', 'walking', 'bicycling', 'transit')),
  constraint route_drive_time_cache_duration_chk check (duration_seconds >= 0),
  constraint route_drive_time_cache_distance_chk check (distance_meters >= 0),
  constraint route_drive_time_cache_key unique (company_id, origin_hash, destination_hash, travel_mode, day_bucket)
);

create index if not exists warehouse_geocodes_company_location_idx
  on public.warehouse_geocodes(company_id, location_id);

create index if not exists customer_geocodes_company_customer_idx
  on public.customer_geocodes(company_id, customer_id);

create index if not exists route_drive_time_cache_company_day_idx
  on public.route_drive_time_cache(company_id, day_bucket);

create index if not exists route_drive_time_cache_route_idx
  on public.route_drive_time_cache(company_id, route_id)
  where route_id is not null;

alter table public.warehouse_geocodes enable row level security;
alter table public.customer_geocodes enable row level security;
alter table public.route_drive_time_cache enable row level security;

drop policy if exists "tenant scoped warehouse geocodes" on public.warehouse_geocodes;
create policy "tenant scoped warehouse geocodes"
  on public.warehouse_geocodes
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped customer geocodes" on public.customer_geocodes;
create policy "tenant scoped customer geocodes"
  on public.customer_geocodes
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped route drive time cache" on public.route_drive_time_cache;
create policy "tenant scoped route drive time cache"
  on public.route_drive_time_cache
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

grant select, insert, update, delete on public.warehouse_geocodes to authenticated;
grant select, insert, update, delete on public.customer_geocodes to authenticated;
grant select, insert, update, delete on public.route_drive_time_cache to authenticated;
