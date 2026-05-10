alter table if exists public.vendors
add column if not exists catalog_item_numbers text[] not null default '{}'::text[];
