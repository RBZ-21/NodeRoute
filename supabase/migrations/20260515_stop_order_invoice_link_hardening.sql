-- Harden order / invoice / stop linkage so delivery and portal workflows do
-- not depend on note parsing or "latest matching row" behavior.

alter table if exists public.stops
  add column if not exists order_id text,
  add column if not exists invoice_id text;

update public.stops as stop
set order_id = orders.id
from public.orders as orders
where stop.order_id is null
  and coalesce(stop.notes, '') ilike ('Order ' || orders.order_number);

update public.stops as stop
set invoice_id = coalesce(stop.invoice_id, orders.invoice_id, invoices.id)
from public.orders as orders
left join public.invoices as invoices
  on invoices.order_id = orders.id
where stop.order_id = orders.id
  and (stop.invoice_id is null or stop.invoice_id = '');

update public.orders as orders
set invoice_id = invoices.id
from public.invoices as invoices
where invoices.order_id = orders.id
  and (orders.invoice_id is null or orders.invoice_id = '');

update public.invoices as invoices
set order_id = orders.id
from public.orders as orders
where orders.invoice_id = invoices.id
  and (invoices.order_id is null or invoices.order_id = '');

create index if not exists idx_stops_order_id
  on public.stops(order_id);

create index if not exists idx_stops_invoice_id
  on public.stops(invoice_id);

create index if not exists idx_orders_invoice_id
  on public.orders(invoice_id);

create index if not exists idx_invoices_order_id
  on public.invoices(order_id);
