-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260417_inventory_lots
-- Purpose  : Lot/Batch & Expiry Tracking for full traceability
--            Supports seafood distributors, pharma, food-safety compliance.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists inventory_lots (
  id                uuid         not null default gen_random_uuid() primary key,
  company_id        uuid         not null default '00000000-0000-0000-0000-000000000001'
                                   references companies(id) on delete cascade,
  item_number       text         not null,
  lot_number        text         not null,
  batch_number      text,
  supplier_name     text,
  country_of_origin text,
  received_date     date         not null default current_date,
  expiry_date       date,
  best_before_date  date,
  qty_received      numeric      not null default 0 check (qty_received >= 0),
  qty_on_hand       numeric      not null default 0 check (qty_on_hand >= 0),
  cost_per_unit     numeric               default 0,
  storage_temp      text,                            -- e.g. "34–38°F / 1–3°C"
  certifications    text,                            -- e.g. "MSC, ASC, Kosher, FDA"
  status            text         not null default 'active'
                      check (status in ('active','depleted','expired','quarantine','recalled')),
  notes             text,
  created_by        text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- Track which lot a stock history entry came from (nullable for legacy rows)
alter table inventory_stock_history
  add column if not exists lot_id uuid references inventory_lots(id) on delete set null;

-- Performance indexes
create index if not exists idx_inv_lots_expiry   on inventory_lots(expiry_date, status);
create index if not exists idx_inv_lots_item     on inventory_lots(item_number, status);
create index if not exists idx_inv_lots_company  on inventory_lots(company_id, status);
create index if not exists idx_inv_lots_recent   on inventory_lots(created_at desc);

-- Auto-update updated_at on any row change
create or replace function set_inv_lot_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inv_lot_updated_at on inventory_lots;
create trigger trg_inv_lot_updated_at
  before update on inventory_lots
  for each row execute function set_inv_lot_updated_at();
