-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260706120000_orders_invoices_fk
-- Finding  : DB-012 (Root Depth Scan, commit 904d7119)
-- Purpose  : orders.invoice_id and invoices.order_id linked the two documents
--            with no referential integrity in either direction.
--
--            Live-verified state at fix time (2026-07-06):
--              orders.invoice_id  = text, no FK, 0 orphaned refs
--              invoices.order_id  = uuid, FK exists (applied out-of-band,
--                                   present in no repo migration)
--
--            This migration converts orders.invoice_id to uuid with a real
--            FK, and codifies the invoices.order_id FK so fresh environments
--            get it too. All steps are idempotent/guarded.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. orders.invoice_id: text → uuid + FK ──────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'invoice_id' and data_type <> 'uuid'
  ) then
    -- Defensively null out non-uuid or orphaned refs before the cast
    -- (0 such rows live at fix time; guards staging/fresh environments).
    update public.orders
    set invoice_id = null
    where invoice_id is not null
      and (
        invoice_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not exists (
          select 1 from public.invoices i where i.id::text = public.orders.invoice_id
        )
      );

    alter table public.orders
      alter column invoice_id type uuid using nullif(invoice_id, '')::uuid;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_invoice_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_invoice_id_fkey
      foreign key (invoice_id) references public.invoices(id) on delete set null;
  end if;
end$$;

create index if not exists idx_orders_invoice_id on public.orders(invoice_id);

-- ── 2. invoices.order_id: codify the out-of-band FK ─────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name = 'order_id' and data_type = 'uuid'
  )
  and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) ilike '%references%orders%'
  ) then
    alter table public.invoices
      add constraint invoices_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete set null;
  end if;
end$$;

create index if not exists idx_invoices_order_id on public.invoices(order_id);
