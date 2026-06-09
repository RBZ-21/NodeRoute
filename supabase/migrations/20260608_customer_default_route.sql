-- Persist the route a customer is assigned to during order entry so future
-- orders default back to that route until a user changes it.
alter table if exists public."Customers"
  add column if not exists default_route_id text;

create index if not exists idx_customers_default_route_id
  on public."Customers"(default_route_id);
