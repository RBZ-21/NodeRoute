-- Phase 4: pricing engine, promotions, quotes, rebates, bill-backs, and minimum sell.

create table if not exists public.price_levels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  constraint price_levels_company_name_key unique (company_id, name)
);

create table if not exists public.customer_price_level_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null,
  price_level_id uuid not null references public.price_levels(id) on delete cascade,
  effective_date date not null default current_date,
  expiry_date date,
  constraint customer_price_level_dates_chk check (expiry_date is null or expiry_date >= effective_date)
);

create index if not exists customer_price_level_assignments_customer_idx
  on public.customer_price_level_assignments(company_id, customer_id, effective_date);

create table if not exists public.price_level_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  price_level_id uuid not null references public.price_levels(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  category_id text,
  method text not null,
  value numeric(12,4) not null,
  constraint price_level_rules_target_chk check (product_id is not null or category_id is not null),
  constraint price_level_rules_method_chk check (
    method in ('fixed_dollar', 'percent_of_cost', 'percent_of_list', 'dollar_over_cost')
  )
);

create index if not exists price_level_rules_level_idx
  on public.price_level_rules(company_id, price_level_id, product_id, category_id);

create table if not exists public.customer_special_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  special_price numeric(12,4) not null,
  effective_date date not null default current_date,
  expiry_date date,
  constraint customer_special_prices_price_chk check (special_price >= 0),
  constraint customer_special_prices_dates_chk check (expiry_date is null or expiry_date >= effective_date)
);

create index if not exists customer_special_prices_customer_product_idx
  on public.customer_special_prices(company_id, customer_id, product_id, effective_date);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null,
  status text not null default 'draft',
  valid_from date not null default current_date,
  valid_until date,
  notes text,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint quotes_status_chk check (status in ('draft', 'active', 'expired', 'cancelled')),
  constraint quotes_dates_chk check (valid_until is null or valid_until >= valid_from)
);

create index if not exists quotes_company_customer_status_idx
  on public.quotes(company_id, customer_id, status, valid_from, valid_until);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quoted_price numeric(12,4) not null,
  min_qty numeric,
  uom text,
  constraint quote_items_price_chk check (quoted_price >= 0),
  constraint quote_items_min_qty_chk check (min_qty is null or min_qty >= 0)
);

create index if not exists quote_items_quote_product_idx
  on public.quote_items(company_id, quote_id, product_id);

create table if not exists public.pricing_update_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scheduled_at timestamptz not null,
  applied_at timestamptz,
  status text not null default 'pending',
  triggered_by text not null,
  created_by text references public.users(id) on delete set null,
  constraint pricing_update_batches_status_chk check (status in ('pending', 'applied', 'failed', 'cancelled'))
);

create index if not exists pricing_update_batches_pending_idx
  on public.pricing_update_batches(company_id, scheduled_at)
  where status = 'pending';

create table if not exists public.pricing_update_batch_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid not null references public.pricing_update_batches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  cost_field text not null,
  old_value numeric,
  new_value numeric,
  new_sell_price numeric,
  constraint pricing_update_batch_items_cost_field_chk check (
    cost_field in ('cost', 'base_cost', 'cost_base', 'landed_cost', 'lot_cost', 'market_cost', 'real_cost', 'cost_real', 'price_per_unit')
  )
);

create index if not exists pricing_update_batch_items_batch_idx
  on public.pricing_update_batch_items(company_id, batch_id, product_id);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  promo_type text not null,
  status text not null default 'draft',
  start_date date not null,
  end_date date,
  constraint promotions_type_chk check (promo_type in ('sale_price', 'percent_off', 'dollar_off', 'buy_x_get_y')),
  constraint promotions_status_chk check (status in ('draft', 'active', 'paused', 'expired')),
  constraint promotions_dates_chk check (end_date is null or end_date >= start_date)
);

create index if not exists promotions_active_idx
  on public.promotions(company_id, status, start_date, end_date);

create table if not exists public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  category_id text,
  value numeric(12,4) not null,
  constraint promotion_items_target_chk check (product_id is not null or category_id is not null),
  constraint promotion_items_value_chk check (value >= 0)
);

create index if not exists promotion_items_promotion_product_idx
  on public.promotion_items(company_id, promotion_id, product_id, category_id);

create table if not exists public.rebates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id text,
  customer_id text,
  name text not null,
  rebate_type text not null,
  value numeric(12,4) not null,
  period_start date not null,
  period_end date not null,
  constraint rebates_type_chk check (rebate_type in ('percent', 'dollar', 'per_unit')),
  constraint rebates_value_chk check (value >= 0),
  constraint rebates_dates_chk check (period_end >= period_start)
);

create index if not exists rebates_company_period_idx
  on public.rebates(company_id, period_start, period_end);

create table if not exists public.bill_backs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id text not null,
  name text not null,
  amount numeric(12,4) not null,
  effective_date date not null,
  settled_at timestamptz,
  constraint bill_backs_amount_chk check (amount >= 0)
);

create index if not exists bill_backs_company_vendor_idx
  on public.bill_backs(company_id, vendor_id, effective_date);

create table if not exists public.minimum_sell_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  category_id text,
  min_margin_pct numeric(5,2),
  min_price numeric(12,4),
  constraint minimum_sell_rules_target_chk check (product_id is not null or category_id is not null),
  constraint minimum_sell_rules_margin_chk check (min_margin_pct is null or (min_margin_pct >= 0 and min_margin_pct < 100)),
  constraint minimum_sell_rules_price_chk check (min_price is null or min_price >= 0)
);

create index if not exists minimum_sell_rules_company_target_idx
  on public.minimum_sell_rules(company_id, product_id, category_id);

alter table public.price_levels enable row level security;
alter table public.customer_price_level_assignments enable row level security;
alter table public.price_level_rules enable row level security;
alter table public.customer_special_prices enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.pricing_update_batches enable row level security;
alter table public.pricing_update_batch_items enable row level security;
alter table public.promotions enable row level security;
alter table public.promotion_items enable row level security;
alter table public.rebates enable row level security;
alter table public.bill_backs enable row level security;
alter table public.minimum_sell_rules enable row level security;

drop policy if exists "tenant scoped price levels" on public.price_levels;
create policy "tenant scoped price levels"
  on public.price_levels
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped customer price level assignments" on public.customer_price_level_assignments;
create policy "tenant scoped customer price level assignments"
  on public.customer_price_level_assignments
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped price level rules" on public.price_level_rules;
create policy "tenant scoped price level rules"
  on public.price_level_rules
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped customer special prices" on public.customer_special_prices;
create policy "tenant scoped customer special prices"
  on public.customer_special_prices
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped quotes" on public.quotes;
create policy "tenant scoped quotes"
  on public.quotes
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped quote items" on public.quote_items;
create policy "tenant scoped quote items"
  on public.quote_items
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped pricing update batches" on public.pricing_update_batches;
create policy "tenant scoped pricing update batches"
  on public.pricing_update_batches
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped pricing update batch items" on public.pricing_update_batch_items;
create policy "tenant scoped pricing update batch items"
  on public.pricing_update_batch_items
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped promotions" on public.promotions;
create policy "tenant scoped promotions"
  on public.promotions
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped promotion items" on public.promotion_items;
create policy "tenant scoped promotion items"
  on public.promotion_items
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped rebates" on public.rebates;
create policy "tenant scoped rebates"
  on public.rebates
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped bill backs" on public.bill_backs;
create policy "tenant scoped bill backs"
  on public.bill_backs
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped minimum sell rules" on public.minimum_sell_rules;
create policy "tenant scoped minimum sell rules"
  on public.minimum_sell_rules
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

grant select, insert, update, delete on public.price_levels to authenticated;
grant select, insert, update, delete on public.customer_price_level_assignments to authenticated;
grant select, insert, update, delete on public.price_level_rules to authenticated;
grant select, insert, update, delete on public.customer_special_prices to authenticated;
grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;
grant select, insert, update, delete on public.pricing_update_batches to authenticated;
grant select, insert, update, delete on public.pricing_update_batch_items to authenticated;
grant select, insert, update, delete on public.promotions to authenticated;
grant select, insert, update, delete on public.promotion_items to authenticated;
grant select, insert, update, delete on public.rebates to authenticated;
grant select, insert, update, delete on public.bill_backs to authenticated;
grant select, insert, update, delete on public.minimum_sell_rules to authenticated;
