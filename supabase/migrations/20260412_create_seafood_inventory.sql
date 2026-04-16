-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260412_create_seafood_inventory
-- Purpose  : Create the seafood_inventory table if it doesn't already exist.
--            Safe to run on a database that already has the table with data.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.seafood_inventory (
  item_number    text        primary key,
  description    text        not null,
  category       text        not null default 'Other',
  unit           text        not null default 'lb',
  cost           numeric     not null default 0,
  on_hand_qty    numeric     not null default 0,
  on_hand_weight numeric     not null default 0,
  lot_item       text        not null default 'N',
  created_at     timestamptz not null default now()
);
