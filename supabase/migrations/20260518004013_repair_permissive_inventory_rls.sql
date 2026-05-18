-- Repair overly permissive and missing inventory RLS policies.
-- All replacement policies are scoped to authenticated admin/manager users in
-- their current company context.

-- REPLACES: Allow all for authenticated
-- REASON: old policy was overly permissive authenticated-only
drop policy if exists "Allow all for authenticated" on public.beer_inventory;
create policy "beer_inventory: admin/manager full access"
  on public.beer_inventory
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "beer_keg_deposits: admin/manager full access"
  on public.beer_keg_deposits
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "beer_stock_history: admin/manager full access"
  on public.beer_stock_history
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: Allow all for authenticated
-- REASON: old policy was overly permissive authenticated-only
drop policy if exists "Allow all for authenticated" on public.food_inventory;
create policy "food_inventory: admin/manager full access"
  on public.food_inventory
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "food_lots: admin/manager full access"
  on public.food_lots
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "food_stock_history: admin/manager full access"
  on public.food_stock_history
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: Allow all for authenticated
-- REASON: old policy was overly permissive authenticated-only
drop policy if exists "Allow all for authenticated" on public.liquor_inventory;
create policy "liquor_inventory: admin/manager full access"
  on public.liquor_inventory
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "liquor_stock_history: admin/manager full access"
  on public.liquor_stock_history
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: Allow all for authenticated
-- REASON: old policy was overly permissive authenticated-only
drop policy if exists "Allow all for authenticated" on public.produce_inventory;
create policy "produce_inventory: admin/manager full access"
  on public.produce_inventory
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "produce_lots: admin/manager full access"
  on public.produce_lots
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "produce_stock_history: admin/manager full access"
  on public.produce_stock_history
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "produce_yield_log: admin/manager full access"
  on public.produce_yield_log
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: Allow all for authenticated
-- REASON: old policy was overly permissive authenticated-only
drop policy if exists "Allow all for authenticated" on public.wine_inventory;
create policy "wine_inventory: admin/manager full access"
  on public.wine_inventory
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: missing policy on RLS-enabled table
-- REASON: table had RLS enabled with no tenant-scoped access policy
create policy "wine_stock_history: admin/manager full access"
  on public.wine_stock_history
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());

-- REPLACES: Authenticated read
-- REPLACES: Authenticated write
-- REASON: old policies were overly permissive authenticated-only
drop policy if exists "Authenticated read" on public.products;
drop policy if exists "Authenticated write" on public.products;
create policy "products: admin/manager full access"
  on public.products
  for all
  to authenticated
  using (is_admin_or_manager() and company_id = auth_company_id())
  with check (is_admin_or_manager() and company_id = auth_company_id());
