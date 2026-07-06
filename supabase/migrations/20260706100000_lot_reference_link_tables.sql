-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260706100000_lot_reference_link_tables
-- Finding  : DB-005 (Root Depth Scan, commit 904d7119) — FSMA 204
-- Purpose  : Lot references lived only as free-text fields inside JSONB
--            (orders.items[].lot_id/lot_number, purchase_orders.items[]
--            .lot_number, stops.shipped_lots[]) with no foreign keys, and two
--            competing lot tables modeled the same concept.
--
--            lot_codes is the canonical lot table (it already carries a
--            UNIQUE constraint on lot_number; inventory_lots does not).
--
--            This migration adds normalized, FK-backed link tables
--            (order_item_lots, po_item_lots, stop_shipped_lots), backfills
--            them from the existing JSONB references, and keeps them in sync
--            via triggers on the parent tables. The JSONB fields are
--            intentionally NOT dropped yet: existing readers (invoice lots,
--            traceability notices, driver app, frontend) still consume them.
--            Dropping the JSONB fields is a tracked follow-up once those
--            readers migrate to the link tables (scope approved by owner).
--
--            lot_id is nullable-by-design: legacy JSONB rows may reference
--            lot numbers that never landed in lot_codes. The verbatim
--            lot_number is always preserved; the FK resolves when a matching
--            canonical lot exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Link tables ───────────────────────────────────────────────────────────

create table if not exists public.order_item_lots (
  id          bigserial primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  item_index  integer,
  item_number text,
  lot_number  text not null,
  lot_id      integer references public.lot_codes(id) on delete set null,
  quantity    numeric(12,4),
  company_id  uuid references public.companies(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.po_item_lots (
  id                bigserial primary key,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_index        integer,
  item_number       text,
  lot_number        text not null,
  lot_id            integer references public.lot_codes(id) on delete set null,
  quantity          numeric(12,4),
  expiration_date   date,
  company_id        uuid references public.companies(id) on delete cascade,
  created_at        timestamptz not null default now()
);

create table if not exists public.stop_shipped_lots (
  id          bigserial primary key,
  stop_id     uuid not null references public.stops(id) on delete cascade,
  item_number text,
  lot_number  text not null,
  lot_id      integer references public.lot_codes(id) on delete set null,
  quantity    numeric(12,4),
  company_id  uuid references public.companies(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_order_item_lots_order on public.order_item_lots(order_id);
create index if not exists idx_order_item_lots_lot   on public.order_item_lots(lot_number);
create index if not exists idx_order_item_lots_lotid on public.order_item_lots(lot_id);
create index if not exists idx_po_item_lots_po       on public.po_item_lots(purchase_order_id);
create index if not exists idx_po_item_lots_lot      on public.po_item_lots(lot_number);
create index if not exists idx_po_item_lots_lotid    on public.po_item_lots(lot_id);
create index if not exists idx_stop_shipped_lots_stop on public.stop_shipped_lots(stop_id);
create index if not exists idx_stop_shipped_lots_lot  on public.stop_shipped_lots(lot_number);
create index if not exists idx_stop_shipped_lots_lotid on public.stop_shipped_lots(lot_id);

-- RLS: strict tenant match (no "IS NULL OR" fail-open — see DB-010).
-- Backend service-role access bypasses RLS as usual.
alter table public.order_item_lots  enable row level security;
alter table public.po_item_lots     enable row level security;
alter table public.stop_shipped_lots enable row level security;

drop policy if exists order_item_lots_tenant on public.order_item_lots;
create policy order_item_lots_tenant on public.order_item_lots
  for all to authenticated
  using (company_id = public.jwt_company_id())
  with check (company_id = public.jwt_company_id());

drop policy if exists po_item_lots_tenant on public.po_item_lots;
create policy po_item_lots_tenant on public.po_item_lots
  for all to authenticated
  using (company_id = public.jwt_company_id())
  with check (company_id = public.jwt_company_id());

drop policy if exists stop_shipped_lots_tenant on public.stop_shipped_lots;
create policy stop_shipped_lots_tenant on public.stop_shipped_lots
  for all to authenticated
  using (company_id = public.jwt_company_id())
  with check (company_id = public.jwt_company_id());

-- ── 2. Shared resync helpers ─────────────────────────────────────────────────
-- Each helper rebuilds the link rows for ONE parent row from its JSONB.
-- Numeric/int casts are guarded so malformed legacy JSON cannot abort writes.

create or replace function public.resync_order_item_lots(p_order_id uuid, p_items jsonb, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from order_item_lots where order_id = p_order_id;
  insert into order_item_lots (order_id, item_index, item_number, lot_number, lot_id, quantity, company_id)
  select
    p_order_id,
    (elem.ord - 1)::int,
    nullif(elem.value ->> 'item_number', ''),
    coalesce(nullif(elem.value ->> 'lot_number', ''), lc_by_id.lot_number),
    coalesce(lc_by_num.id, lc_by_id.id),
    case when elem.value ->> 'quantity_from_lot' ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (elem.value ->> 'quantity_from_lot')::numeric end,
    p_company_id
  from jsonb_array_elements(
         case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
       ) with ordinality as elem(value, ord)
  left join lot_codes lc_by_num
         on lc_by_num.lot_number = nullif(elem.value ->> 'lot_number', '')
  left join lot_codes lc_by_id
         on lc_by_id.id = case when elem.value ->> 'lot_id' ~ '^[0-9]+$'
                               then (elem.value ->> 'lot_id')::int end
  where nullif(elem.value ->> 'lot_number', '') is not null
     or elem.value ->> 'lot_id' ~ '^[0-9]+$';
end;
$$;

create or replace function public.resync_po_item_lots(p_po_id uuid, p_items jsonb, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from po_item_lots where purchase_order_id = p_po_id;
  insert into po_item_lots (purchase_order_id, item_index, item_number, lot_number, lot_id, quantity, expiration_date, company_id)
  select
    p_po_id,
    (elem.ord - 1)::int,
    nullif(elem.value ->> 'item_number', ''),
    nullif(elem.value ->> 'lot_number', ''),
    lc.id,
    case when elem.value ->> 'quantity' ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (elem.value ->> 'quantity')::numeric end,
    case when elem.value ->> 'expiration_date' ~ '^\d{4}-\d{2}-\d{2}'
         then substring(elem.value ->> 'expiration_date' from 1 for 10)::date end,
    p_company_id
  from jsonb_array_elements(
         case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
       ) with ordinality as elem(value, ord)
  left join lot_codes lc on lc.lot_number = nullif(elem.value ->> 'lot_number', '')
  where nullif(elem.value ->> 'lot_number', '') is not null;
end;
$$;

create or replace function public.resync_stop_shipped_lots(p_stop_id uuid, p_shipped jsonb, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from stop_shipped_lots where stop_id = p_stop_id;
  insert into stop_shipped_lots (stop_id, item_number, lot_number, lot_id, quantity, company_id)
  select
    p_stop_id,
    nullif(elem.value ->> 'product_id', ''),
    nullif(elem.value ->> 'lot_number', ''),
    lc.id,
    case when elem.value ->> 'quantity' ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (elem.value ->> 'quantity')::numeric end,
    p_company_id
  from jsonb_array_elements(
         case when jsonb_typeof(p_shipped) = 'array' then p_shipped else '[]'::jsonb end
       ) as elem(value)
  left join lot_codes lc on lc.lot_number = nullif(elem.value ->> 'lot_number', '')
  where nullif(elem.value ->> 'lot_number', '') is not null;
end;
$$;

-- ── 3. Sync triggers on the parent tables ────────────────────────────────────

create or replace function public.trg_fn_sync_order_item_lots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform resync_order_item_lots(new.id, new.items, new.company_id);
  return new;
end;
$$;

drop trigger if exists trg_sync_order_item_lots on public.orders;
create trigger trg_sync_order_item_lots
  after insert or update of items on public.orders
  for each row execute function public.trg_fn_sync_order_item_lots();

create or replace function public.trg_fn_sync_po_item_lots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform resync_po_item_lots(new.id, new.items, new.company_id);
  return new;
end;
$$;

drop trigger if exists trg_sync_po_item_lots on public.purchase_orders;
create trigger trg_sync_po_item_lots
  after insert or update of items on public.purchase_orders
  for each row execute function public.trg_fn_sync_po_item_lots();

create or replace function public.trg_fn_sync_stop_shipped_lots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform resync_stop_shipped_lots(new.id, new.shipped_lots, new.company_id);
  return new;
end;
$$;

drop trigger if exists trg_sync_stop_shipped_lots on public.stops;
create trigger trg_sync_stop_shipped_lots
  after insert or update of shipped_lots on public.stops
  for each row execute function public.trg_fn_sync_stop_shipped_lots();

-- ── 4. Backfill from existing JSONB references ───────────────────────────────

do $$
declare
  r record;
begin
  for r in select id, items, company_id from orders
           where items is not null and jsonb_typeof(items) = 'array'
  loop
    perform resync_order_item_lots(r.id, r.items, r.company_id);
  end loop;

  for r in select id, items, company_id from purchase_orders
           where items is not null and jsonb_typeof(items) = 'array'
  loop
    perform resync_po_item_lots(r.id, r.items, r.company_id);
  end loop;

  for r in select id, shipped_lots, company_id from stops
           where shipped_lots is not null and jsonb_typeof(shipped_lots) = 'array'
  loop
    perform resync_stop_shipped_lots(r.id, r.shipped_lots, r.company_id);
  end loop;
end;
$$;
