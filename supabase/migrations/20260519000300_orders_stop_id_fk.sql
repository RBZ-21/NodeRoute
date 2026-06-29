alter table public.orders
  add column if not exists stop_id uuid references public.stops(id) on delete set null;

create index if not exists idx_orders_stop_id
  on public.orders(stop_id);
