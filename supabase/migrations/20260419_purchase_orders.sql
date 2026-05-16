-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260419_purchase_orders
-- Purpose  : Purchase order records created from scanned PO photos.
--            Tracks vendor invoices / cost-of-goods for financial reporting.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists purchase_orders (
  id             uuid        primary key default gen_random_uuid(),
  po_number      text,
  vendor         text,
  items          jsonb       not null default '[]',
  total_cost     numeric     not null default 0,
  notes          text,
  confirmed_by   text,
  scanned_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists idx_po_created   on purchase_orders(created_at desc);
create index if not exists idx_po_vendor    on purchase_orders(vendor);
