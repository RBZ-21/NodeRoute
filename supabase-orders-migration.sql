-- Run this in your Supabase SQL Editor
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  customer_name text not null,
  customer_email text,
  customer_address text,
  items jsonb default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','in_process','processed','invoiced')),
  driver_name text,
  route_id uuid,
  notes text,
  created_at timestamptz default now()
);
alter table orders enable row level security;
create policy "Allow all for authenticated" on orders for all using (true);
