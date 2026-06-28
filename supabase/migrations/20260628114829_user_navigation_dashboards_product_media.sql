-- Phase 1: customizable shell, dashboard layouts, and product media URLs.

create table if not exists public.user_menu_preferences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  nav_item_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_menu_preferences_nav_array_chk check (jsonb_typeof(nav_item_ids) = 'array'),
  constraint user_menu_preferences_company_user_key unique (company_id, user_id)
);

create table if not exists public.dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  user_id text references public.users(id) on delete cascade,
  role text,
  view_type text not null,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint dashboard_layouts_view_type_chk check (
    view_type in ('inventory', 'customer', 'vendor', 'salesperson', 'brand', 'class')
  ),
  constraint dashboard_layouts_layout_object_chk check (jsonb_typeof(layout) = 'object')
);

create unique index if not exists dashboard_layouts_user_view_idx
  on public.dashboard_layouts(company_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(user_id, ''), view_type);

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  media_type text not null default 'image',
  url text not null,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint product_media_type_chk check (media_type in ('image', 'library', 'url')),
  constraint product_media_url_chk check (url ~* '^https://')
);

create index if not exists product_media_product_sort_idx
  on public.product_media(company_id, product_id, sort_order)
  where deleted_at is null;

create table if not exists public.product_image_library (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null,
  url text not null,
  label text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint product_image_library_url_chk check (url ~* '^https://')
);

create index if not exists product_image_library_tags_idx
  on public.product_image_library using gin(tags);

alter table if exists public."Customers"
  add column if not exists avatar_url text;

alter table if exists public."Customers"
  add constraint customers_avatar_url_https_chk
  check (avatar_url is null or avatar_url ~* '^https://')
  not valid;

alter table public.user_menu_preferences enable row level security;
alter table public.dashboard_layouts enable row level security;
alter table public.product_media enable row level security;
alter table public.product_image_library enable row level security;

drop policy if exists "tenant scoped user menu preferences" on public.user_menu_preferences;
create policy "tenant scoped user menu preferences"
  on public.user_menu_preferences
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped dashboard layouts" on public.dashboard_layouts;
create policy "tenant scoped dashboard layouts"
  on public.dashboard_layouts
  for all
  to authenticated
  using (public.row_company_allowed(company_id) and public.row_location_allowed(location_id))
  with check (public.row_company_allowed(company_id) and public.row_location_allowed(location_id));

drop policy if exists "tenant scoped product media" on public.product_media;
create policy "tenant scoped product media"
  on public.product_media
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

drop policy if exists "tenant scoped product image library" on public.product_image_library;
create policy "tenant scoped product image library"
  on public.product_image_library
  for all
  to authenticated
  using (public.row_company_allowed(company_id))
  with check (public.row_company_allowed(company_id));

grant select, insert, update, delete on public.user_menu_preferences to authenticated;
grant select, insert, update, delete on public.dashboard_layouts to authenticated;
grant select, insert, update, delete on public.product_media to authenticated;
grant select, insert, update, delete on public.product_image_library to authenticated;
