-- Phase 5: advanced order entry workflows, document variants, returns, credits, and scan-to-add.

create table if not exists public.order_guides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists order_guides_customer_active_idx
  on public.order_guides(company_id, location_id, customer_id, is_active);

create table if not exists public.order_guide_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  order_guide_id uuid not null references public.order_guides(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sort_order int not null default 0,
  default_qty numeric,
  default_uom text,
  constraint order_guide_items_qty_chk check (default_qty is null or default_qty >= 0)
);

create index if not exists order_guide_items_guide_sort_idx
  on public.order_guide_items(company_id, location_id, order_guide_id, sort_order);

create table if not exists public.customer_substitutions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  original_product_id uuid not null references public.products(id) on delete cascade,
  substitute_product_id uuid not null references public.products(id) on delete cascade,
  priority int not null default 0,
  is_active boolean not null default true
);

create index if not exists customer_substitutions_lookup_idx
  on public.customer_substitutions(company_id, location_id, customer_id, original_product_id, is_active, priority);

create table if not exists public.customer_hot_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  message text not null,
  message_type text not null,
  start_date date,
  end_date date,
  constraint customer_hot_messages_type_chk check (message_type in ('order_entry', 'delivery', 'invoice')),
  constraint customer_hot_messages_dates_chk check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists customer_hot_messages_lookup_idx
  on public.customer_hot_messages(company_id, location_id, customer_id, message_type, start_date, end_date);

create table if not exists public.customer_item_instructions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  instruction text not null,
  instruction_type text not null,
  constraint customer_item_instructions_type_chk check (instruction_type in ('cutting', 'packaging', 'warehouse', 'general'))
);

create index if not exists customer_item_instructions_lookup_idx
  on public.customer_item_instructions(company_id, location_id, customer_id, product_id, instruction_type);

create table if not exists public.invoice_addons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric not null,
  uom text,
  price numeric(12,4) not null,
  added_by uuid references public.users(id) on delete set null,
  added_at timestamptz not null default now(),
  reason text,
  constraint invoice_addons_qty_chk check (qty > 0),
  constraint invoice_addons_price_chk check (price >= 0)
);

create index if not exists invoice_addons_invoice_idx
  on public.invoice_addons(company_id, location_id, invoice_id, added_at);

create table if not exists public.customer_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  customer_id text not null,
  return_date date not null default current_date,
  status text not null default 'draft',
  created_by uuid references public.users(id) on delete set null,
  constraint customer_returns_status_chk check (status in ('draft', 'approved', 'received', 'credited', 'void'))
);

create index if not exists customer_returns_customer_idx
  on public.customer_returns(company_id, location_id, customer_id, return_date);

create table if not exists public.credit_memos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id text not null,
  original_invoice_id uuid references public.invoices(id) on delete set null,
  amount numeric(12,4) not null,
  reason text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint credit_memos_amount_chk check (amount >= 0),
  constraint credit_memos_status_chk check (status in ('draft', 'issued', 'applied', 'void'))
);

create index if not exists credit_memos_customer_idx
  on public.credit_memos(company_id, location_id, customer_id, created_at);

create table if not exists public.bottle_deposits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  deposit_amount numeric(12,4) not null,
  deposit_uom text,
  is_active boolean not null default true,
  constraint bottle_deposits_amount_chk check (deposit_amount >= 0)
);

create index if not exists bottle_deposits_product_idx
  on public.bottle_deposits(company_id, location_id, product_id, is_active);

create table if not exists public.fuel_surcharge_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  method text not null,
  value numeric(12,4) not null,
  min_order_value numeric,
  effective_date date not null default current_date,
  expiry_date date,
  constraint fuel_surcharge_rules_method_chk check (method in ('flat', 'percent_of_order')),
  constraint fuel_surcharge_rules_value_chk check (value >= 0),
  constraint fuel_surcharge_rules_min_order_chk check (min_order_value is null or min_order_value >= 0),
  constraint fuel_surcharge_rules_dates_chk check (expiry_date is null or expiry_date >= effective_date)
);

create index if not exists fuel_surcharge_rules_active_idx
  on public.fuel_surcharge_rules(company_id, location_id, effective_date, expiry_date);

create table if not exists public.barcode_scan_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  order_id uuid not null references public.orders(id) on delete cascade,
  barcode text not null,
  resolved_product_id uuid references public.products(id) on delete set null,
  scanned_by uuid references public.users(id) on delete set null,
  scanned_at timestamptz not null default now(),
  constraint barcode_scan_events_order_barcode_key unique (company_id, order_id, barcode)
);

create index if not exists barcode_scan_events_order_idx
  on public.barcode_scan_events(company_id, location_id, order_id, scanned_at);

alter table public.order_guides enable row level security;
alter table public.order_guide_items enable row level security;
alter table public.customer_substitutions enable row level security;
alter table public.customer_hot_messages enable row level security;
alter table public.customer_item_instructions enable row level security;
alter table public.invoice_addons enable row level security;
alter table public.customer_returns enable row level security;
alter table public.credit_memos enable row level security;
alter table public.bottle_deposits enable row level security;
alter table public.fuel_surcharge_rules enable row level security;
alter table public.barcode_scan_events enable row level security;

drop policy if exists "tenant scoped order guides" on public.order_guides;
create policy "tenant scoped order guides"
  on public.order_guides for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped order guide items" on public.order_guide_items;
create policy "tenant scoped order guide items"
  on public.order_guide_items for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped customer substitutions" on public.customer_substitutions;
create policy "tenant scoped customer substitutions"
  on public.customer_substitutions for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped customer hot messages" on public.customer_hot_messages;
create policy "tenant scoped customer hot messages"
  on public.customer_hot_messages for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped customer item instructions" on public.customer_item_instructions;
create policy "tenant scoped customer item instructions"
  on public.customer_item_instructions for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped invoice addons" on public.invoice_addons;
create policy "tenant scoped invoice addons"
  on public.invoice_addons for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped customer returns" on public.customer_returns;
create policy "tenant scoped customer returns"
  on public.customer_returns for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped credit memos" on public.credit_memos;
create policy "tenant scoped credit memos"
  on public.credit_memos for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped bottle deposits" on public.bottle_deposits;
create policy "tenant scoped bottle deposits"
  on public.bottle_deposits for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped fuel surcharge rules" on public.fuel_surcharge_rules;
create policy "tenant scoped fuel surcharge rules"
  on public.fuel_surcharge_rules for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped barcode scan events" on public.barcode_scan_events;
create policy "tenant scoped barcode scan events"
  on public.barcode_scan_events for all to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

grant select, insert, update, delete on public.order_guides to authenticated;
grant select, insert, update, delete on public.order_guide_items to authenticated;
grant select, insert, update, delete on public.customer_substitutions to authenticated;
grant select, insert, update, delete on public.customer_hot_messages to authenticated;
grant select, insert, update, delete on public.customer_item_instructions to authenticated;
grant select, insert, update, delete on public.invoice_addons to authenticated;
grant select, insert, update, delete on public.customer_returns to authenticated;
grant select, insert, update, delete on public.credit_memos to authenticated;
grant select, insert, update, delete on public.bottle_deposits to authenticated;
grant select, insert, update, delete on public.fuel_surcharge_rules to authenticated;
grant select, insert, update, delete on public.barcode_scan_events to authenticated;
