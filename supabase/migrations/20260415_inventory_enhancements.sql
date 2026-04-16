-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260415_inventory_enhancements
-- Purpose  : Yield tracking, stock-movement history, and low-stock alert state
--            for seafood_inventory. Supports multi-company scale.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend seafood_inventory with new columns
alter table seafood_inventory
  add column if not exists avg_yield       numeric       default null,
  add column if not exists yield_count     integer       default 0,
  add column if not exists updated_at      timestamptz   default now(),
  add column if not exists alert_sent_at   timestamptz   default null;

-- Auto-update updated_at on every row change
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_updated_at on seafood_inventory;
create trigger trg_inventory_updated_at
  before update on seafood_inventory
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Stock movement history
--    change_type: 'restock' | 'adjustment' | 'depletion' | 'sale' | 'waste'
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_stock_history (
  id          uuid        primary key default gen_random_uuid(),
  product_id  uuid        not null references seafood_inventory(id) on delete cascade,
  change_qty  numeric     not null,
  new_qty     numeric     not null,
  change_type text        not null default 'adjustment',
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_inv_hist_product_time
  on inventory_stock_history(product_id, created_at desc);

create index if not exists idx_inv_hist_type
  on inventory_stock_history(change_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Yield log — raw vs trimmed weight per cutting session
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_yield_log (
  id            uuid        primary key default gen_random_uuid(),
  product_id    uuid        not null references seafood_inventory(id) on delete cascade,
  raw_weight    numeric     not null,
  yield_weight  numeric     not null,
  yield_pct     numeric     not null,
  notes         text,
  logged_by     text,
  logged_at     timestamptz not null default now()
);

create index if not exists idx_inv_yield_product
  on inventory_yield_log(product_id, logged_at desc);
