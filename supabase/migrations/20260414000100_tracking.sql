-- Run in Supabase SQL Editor

-- Tracking token + geocoded coords on orders
alter table orders
  add column if not exists tracking_token      text unique,
  add column if not exists tracking_expires_at timestamptz,
  add column if not exists customer_phone      text,
  add column if not exists customer_lat        numeric,
  add column if not exists customer_lng        numeric;

-- Driver location table (updated by driver app / dispatch)
create table if not exists driver_locations (
  id          uuid primary key default gen_random_uuid(),
  driver_name text not null unique,
  lat         numeric not null default 32.7765,
  lng         numeric not null default -79.9311,
  heading     numeric default 0,
  speed_mph   numeric default 0,
  updated_at  timestamptz default now()
);
alter table driver_locations enable row level security;
create policy "Allow all for authenticated" on driver_locations
  for all using (true);

comment on table driver_locations is
  'Real-time driver GPS positions. Updated by driver mobile app or dispatch.';
