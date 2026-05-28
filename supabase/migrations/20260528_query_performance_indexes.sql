-- Performance hardening: add indexes for common tenant filters, joins, and sort columns.
-- This migration is defensive across evolving schemas: it creates each index only
-- when the referenced table and columns exist.

create or replace function public.create_index_if_columns_exist(
  index_name text,
  table_name text,
  index_columns_sql text,
  required_columns text[]
)
returns void
language plpgsql
as $$
declare
  column_name text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = create_index_if_columns_exist.table_name
  ) then
    return;
  end if;

  foreach column_name in array required_columns loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = create_index_if_columns_exist.table_name
        and column_name = column_name
    ) then
      return;
    end if;
  end loop;

  execute format('create index if not exists %I on public.%I (%s)', index_name, table_name, index_columns_sql);
end $$;

select public.create_index_if_columns_exist('idx_orders_company_status_created', 'orders', 'company_id, status, created_at desc', array['company_id','status','created_at']);
select public.create_index_if_columns_exist('idx_orders_company_customer', 'orders', 'company_id, customer_name', array['company_id','customer_name']);
select public.create_index_if_columns_exist('idx_orders_tracking_token', 'orders', 'tracking_token', array['tracking_token']);
select public.create_index_if_columns_exist('idx_orders_stop_id', 'orders', 'stop_id', array['stop_id']);
select public.create_index_if_columns_exist('idx_invoices_company_status_created', 'invoices', 'company_id, status, created_at desc', array['company_id','status','created_at']);
select public.create_index_if_columns_exist('idx_invoices_company_order_id', 'invoices', 'company_id, order_id', array['company_id','order_id']);
select public.create_index_if_columns_exist('idx_routes_company_driver_created', 'routes', 'company_id, driver_id, created_at desc', array['company_id','driver_id','created_at']);
select public.create_index_if_columns_exist('idx_routes_company_status', 'routes', 'company_id, status', array['company_id','status']);
select public.create_index_if_columns_exist('idx_stops_company_route_created', 'stops', 'company_id, route_id, created_at desc', array['company_id','route_id','created_at']);
select public.create_index_if_columns_exist('idx_stops_company_scheduled', 'stops', 'company_id, scheduled_date, scheduled_time', array['company_id','scheduled_date','scheduled_time']);
select public.create_index_if_columns_exist('idx_driver_locations_company_name_updated', 'driver_locations', 'company_id, lower(driver_name), updated_at desc', array['company_id','driver_name','updated_at']);
select public.create_index_if_columns_exist('idx_products_company_item_number', 'products', 'company_id, item_number', array['company_id','item_number']);
select public.create_index_if_columns_exist('idx_products_company_active', 'products', 'company_id, is_active', array['company_id','is_active']);
select public.create_index_if_columns_exist('idx_customers_company_name', 'customers', 'company_id, name', array['company_id','name']);
select public.create_index_if_columns_exist('idx_customers_company_email', 'customers', 'company_id, email', array['company_id','email']);
select public.create_index_if_columns_exist('idx_users_company_email', 'users', 'company_id, lower(email)', array['company_id','email']);
select public.create_index_if_columns_exist('idx_portal_contacts_company_email', 'portal_contacts', 'company_id, lower(email)', array['company_id','email']);
select public.create_index_if_columns_exist('idx_dwell_records_company_route_stop', 'dwell_records', 'company_id, route_id, stop_id', array['company_id','route_id','stop_id']);
select public.create_index_if_columns_exist('idx_lot_codes_company_product', 'lot_codes', 'company_id, product_id', array['company_id','product_id']);
select public.create_index_if_columns_exist('idx_purchase_orders_company_status_created', 'purchase_orders', 'company_id, status, created_at desc', array['company_id','status','created_at']);
select public.create_index_if_columns_exist('idx_vendor_bills_company_status_created', 'vendor_bills', 'company_id, status, created_at desc', array['company_id','status','created_at']);
select public.create_index_if_columns_exist('idx_audit_log_company_created', 'audit_log', 'company_id, created_at desc', array['company_id','created_at']);

-- Keep helper available for future conditional index migrations.