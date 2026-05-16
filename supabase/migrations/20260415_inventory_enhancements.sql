-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260415_inventory_enhancements
-- Purpose  : Yield tracking, stock-movement history, and low-stock alert state
--            for seafood_inventory. Supports multi-company scale.
-- Note     : seafood_inventory uses item_number (text) as its identifier —
--            there is no uuid id column on that table.
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

create trigger trg_inventory_updated_at
  before update on seafood_inventory
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Stock movement history
--    change_type: 'restock' | 'adjustment' | 'depletion' | 'sale' | 'waste'
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_stock_history (
  id          uuid        primary key default gen_random_uuid(),
  item_number text        not null,
  change_qty  numeric     not null,
  new_qty     numeric     not null,
  change_type text        not null default 'adjustment',
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_inv_hist_item_time
  on inventory_stock_history(item_number, created_at desc);

create index if not exists idx_inv_hist_type
  on inventory_stock_history(change_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Yield log — raw vs trimmed weight per cutting session
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_yield_log (
  id            uuid        primary key default gen_random_uuid(),
  item_number   text        not null,
  raw_weight    numeric     not null,
  yield_weight  numeric     not null,
  yield_pct     numeric     not null,
  notes         text,
  logged_by     text,
  logged_at     timestamptz not null default now()
);

create index if not exists idx_inv_yield_item
  on inventory_yield_log(item_number, logged_at desc);
