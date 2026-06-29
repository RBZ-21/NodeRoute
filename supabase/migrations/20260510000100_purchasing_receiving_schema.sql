-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260510_purchasing_receiving_schema
-- Purpose  : Align the live purchasing schema with the vendor PO / receiving
--            workflow already implemented in the application layer.
--            Adds normalized receiving, discrepancy, scan, approval, and
--            lead-time support while keeping the existing purchase_orders table
--            as the canonical PO header record.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Vendors baseline table + UUID normalization for live environments where
--    vendors.id was created as bigint outside repo-managed migrations.
create table if not exists public.vendors (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  contact              text,
  email                text,
  phone                text,
  category             text,
  catalog_item_numbers text[] not null default '{}'::text[],
  status               text not null default 'active',
  address              text,
  notes                text,
  payment_terms        text,
  company_id           uuid not null default '00000000-0000-0000-0000-000000000001'
                         references public.companies(id) on delete cascade,
  location_id          uuid default '00000000-0000-0000-0000-000000000101'
                         references public.locations(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table if exists public.vendors
  add column if not exists contact text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists category text,
  add column if not exists catalog_item_numbers text[] not null default '{}'::text[],
  add column if not exists status text not null default 'active',
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists payment_terms text,
  add column if not exists company_id uuid default '00000000-0000-0000-0000-000000000001'
    references public.companies(id) on delete cascade,
  add column if not exists location_id uuid default '00000000-0000-0000-0000-000000000101'
    references public.locations(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  vendors_id_type text;
  vendors_pkey_name text;
begin
  if to_regclass('public.vendors') is null then
    return;
  end if;

  select a.atttypid::regtype::text
  into vendors_id_type
  from pg_attribute a
  where a.attrelid = 'public.vendors'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if vendors_id_type is null then
    alter table public.vendors add column id uuid;
    update public.vendors set id = gen_random_uuid() where id is null;
    alter table public.vendors alter column id set default gen_random_uuid();
    alter table public.vendors alter column id set not null;
    alter table public.vendors add primary key (id);
  elsif vendors_id_type <> 'uuid' then
    select conname
    into vendors_pkey_name
    from pg_constraint
    where conrelid = 'public.vendors'::regclass
      and contype = 'p'
    limit 1;

    if vendors_pkey_name is not null then
      execute format('alter table public.vendors drop constraint %I', vendors_pkey_name);
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vendors'
        and column_name = 'legacy_numeric_id'
    ) then
      alter table public.vendors rename column id to legacy_numeric_id;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vendors'
        and column_name = 'id'
    ) then
      alter table public.vendors add column id uuid;
    end if;

    update public.vendors set id = coalesce(id, gen_random_uuid());
    alter table public.vendors alter column id set default gen_random_uuid();
    alter table public.vendors alter column id set not null;
    alter table public.vendors add primary key (id);
  else
    alter table public.vendors alter column id set default gen_random_uuid();
  end if;
end $$;

update public.vendors
set
  status = coalesce(nullif(lower(btrim(status)), ''), 'active'),
  company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001'),
  location_id = coalesce(location_id, '00000000-0000-0000-0000-000000000101'),
  updated_at = coalesce(updated_at, now())
where
  status is null
  or btrim(status) = ''
  or company_id is null
  or location_id is null
  or updated_at is null;

create unique index if not exists idx_vendors_company_name
  on public.vendors(company_id, lower(name));

create or replace function public.set_vendor_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_vendors_updated_at on public.vendors;
create trigger trg_vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_vendor_updated_at();

-- 2. Extend purchase_orders so vendor POs and scan-confirmed receipts can share
--    one canonical header table.
alter table if exists public.purchase_orders
  add column if not exists workflow_id text,
  add column if not exists workflow_kind text not null default 'inventory_receipt',
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null,
  add column if not exists status text not null default 'open',
  add column if not exists expected_date date,
  add column if not exists invoice_image_url text,
  add column if not exists received_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists receipt_rules jsonb not null default '{}'::jsonb,
  add column if not exists receipts jsonb not null default '[]'::jsonb,
  add column if not exists source_draft_id text,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists source_scan_id uuid;

update public.purchase_orders
set workflow_id = coalesce(nullif(btrim(workflow_id), ''), id::text)
where workflow_id is null or btrim(workflow_id) = '';

update public.purchase_orders
set workflow_kind = coalesce(nullif(lower(btrim(workflow_kind)), ''), 'inventory_receipt')
where workflow_kind is null or btrim(workflow_kind) = '';

update public.purchase_orders
set po_number =
  concat(
    'PO-',
    to_char(coalesce(created_at, now()), 'YYYYMMDD'),
    '-',
    upper(substr(replace(coalesce(workflow_id, id::text), '-', ''), 1, 6))
  )
where po_number is null or btrim(po_number) = '';

with ranked as (
  select
    id,
    po_number,
    row_number() over (partition by po_number order by created_at nulls last, id) as rn
  from public.purchase_orders
)
update public.purchase_orders po
set po_number = concat(ranked.po_number, '-', upper(substr(replace(po.id::text, '-', ''), 1, 4)))
from ranked
where ranked.id = po.id
  and ranked.rn > 1;

alter table public.purchase_orders
  alter column po_number set not null;

update public.purchase_orders po
set vendor_id = v.id
from public.vendors v
where po.vendor_id is null
  and nullif(btrim(po.vendor), '') is not null
  and lower(v.name) = lower(po.vendor);

update public.purchase_orders
set status = case
  when status is null or btrim(status) = '' then
    case
      when workflow_kind = 'vendor_order' then 'open'
      else 'received'
    end
  else lower(btrim(status))
end;

create unique index if not exists idx_purchase_orders_po_number_unique
  on public.purchase_orders(po_number);

create unique index if not exists idx_purchase_orders_workflow_id_unique
  on public.purchase_orders(workflow_id);

create index if not exists idx_purchase_orders_vendor_id
  on public.purchase_orders(vendor_id);

create index if not exists idx_purchase_orders_workflow_kind
  on public.purchase_orders(workflow_kind, status, created_at desc);

create or replace function public.set_purchase_order_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_updated_at on public.purchase_orders;
create trigger trg_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_purchase_order_updated_at();

-- 3. Scan, receiving, discrepancy, and approval tables.
create table if not exists public.po_invoice_scans (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  vendor_id         uuid references public.vendors(id) on delete set null,
  source            text not null default 'upload',
  file_name         text,
  mime_type         text,
  invoice_image_url text,
  parsed_vendor     text,
  parsed_po_number  text,
  parsed_date       date,
  parsed_total_cost numeric,
  parsed_items      jsonb not null default '[]'::jsonb,
  status            text not null default 'parsed',
  created_by        text,
  approved_by       text,
  approved_at       timestamptz,
  parsed_at         timestamptz not null default now(),
  company_id        uuid not null default '00000000-0000-0000-0000-000000000001'
                      references public.companies(id) on delete cascade,
  location_id       uuid default '00000000-0000-0000-0000-000000000101'
                      references public.locations(id) on delete set null
);

create index if not exists idx_po_invoice_scans_po
  on public.po_invoice_scans(purchase_order_id, parsed_at desc);

create index if not exists idx_po_invoice_scans_vendor
  on public.po_invoice_scans(vendor_id, parsed_at desc);

create table if not exists public.po_receipts (
  id                    uuid primary key default gen_random_uuid(),
  purchase_order_id     uuid not null references public.purchase_orders(id) on delete cascade,
  scan_id               uuid references public.po_invoice_scans(id) on delete set null,
  notes                 text,
  received_by           text,
  received_at           timestamptz not null default now(),
  receipt_rules_applied jsonb not null default '{}'::jsonb,
  variance_audit        jsonb not null default '{}'::jsonb,
  company_id            uuid not null default '00000000-0000-0000-0000-000000000001'
                          references public.companies(id) on delete cascade,
  location_id           uuid default '00000000-0000-0000-0000-000000000101'
                          references public.locations(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_po_receipts_po
  on public.po_receipts(purchase_order_id, received_at desc);

create table if not exists public.po_receiving_lines (
  id                             uuid primary key default gen_random_uuid(),
  purchase_order_id              uuid not null references public.purchase_orders(id) on delete cascade,
  receipt_id                     uuid not null references public.po_receipts(id) on delete cascade,
  line_no                        integer not null,
  item_number                    text,
  product_name                   text,
  lot_number                     text,
  qty_received                   numeric not null default 0,
  requested_receive_qty          numeric not null default 0,
  accepted_receive_qty           numeric not null default 0,
  rejected_receive_qty           numeric not null default 0,
  over_receipt_qty               numeric not null default 0,
  remaining_before_qty           numeric not null default 0,
  remaining_after_qty            numeric not null default 0,
  quantity_variance_qty          numeric not null default 0,
  variance_type                  text not null default 'exact_receipt',
  backordered_qty_after_receipt  numeric not null default 0,
  waived_backorder_qty_applied   numeric not null default 0,
  unit                           text,
  unit_cost                      numeric default 0,
  approval_required              boolean not null default false,
  approval_status                text not null default 'not_required',
  approved_at                    timestamptz,
  approved_by                    text,
  company_id                     uuid not null default '00000000-0000-0000-0000-000000000001'
                                   references public.companies(id) on delete cascade,
  location_id                    uuid default '00000000-0000-0000-0000-000000000101'
                                   references public.locations(id) on delete set null,
  created_at                     timestamptz not null default now(),
  unique (receipt_id, line_no)
);

create index if not exists idx_po_receiving_lines_po
  on public.po_receiving_lines(purchase_order_id, created_at desc);

create index if not exists idx_po_receiving_lines_receipt
  on public.po_receiving_lines(receipt_id, line_no);

create table if not exists public.po_discrepancy_log (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  receipt_id          uuid references public.po_receipts(id) on delete cascade,
  receipt_line_id     uuid references public.po_receiving_lines(id) on delete cascade,
  line_no             integer,
  item_number         text,
  product_name        text,
  expected_qty        numeric not null default 0,
  requested_qty       numeric not null default 0,
  accepted_qty        numeric not null default 0,
  rejected_qty        numeric not null default 0,
  over_receipt_qty    numeric not null default 0,
  remaining_after_qty numeric not null default 0,
  variance_qty        numeric not null default 0,
  variance_type       text not null,
  flagged_at          timestamptz not null default now(),
  flagged_by          text,
  company_id          uuid not null default '00000000-0000-0000-0000-000000000001'
                        references public.companies(id) on delete cascade,
  location_id         uuid default '00000000-0000-0000-0000-000000000101'
                        references public.locations(id) on delete set null
);

create index if not exists idx_po_discrepancy_log_po
  on public.po_discrepancy_log(purchase_order_id, flagged_at desc);

create index if not exists idx_po_discrepancy_log_receipt
  on public.po_discrepancy_log(receipt_id, flagged_at desc);

create table if not exists public.po_receiving_approval_queue (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  receipt_id        uuid references public.po_receipts(id) on delete cascade,
  receipt_line_id   uuid references public.po_receiving_lines(id) on delete cascade,
  line_no           integer not null,
  item_number       text,
  product_name      text,
  approval_type     text not null default 'count_item',
  requested_qty     numeric not null default 0,
  status            text not null default 'pending',
  decision_notes    text,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        text,
  company_id        uuid not null default '00000000-0000-0000-0000-000000000001'
                      references public.companies(id) on delete cascade,
  location_id       uuid default '00000000-0000-0000-0000-000000000101'
                      references public.locations(id) on delete set null
);

create index if not exists idx_po_receiving_approval_queue_po
  on public.po_receiving_approval_queue(purchase_order_id, status, created_at desc);

-- 4. Lot traceability back to the originating PO.
alter table if exists public.inventory_lots
  add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;

alter table if exists public.lot_codes
  add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;

create index if not exists idx_inventory_lots_purchase_order_id
  on public.inventory_lots(purchase_order_id);

create index if not exists idx_lot_codes_purchase_order_id
  on public.lot_codes(purchase_order_id);

-- 5. Lead-time view derived from vendor-order receipts.
create or replace view public.vendor_lead_times
with (security_invoker = true) as
select
  po.vendor_id,
  po.vendor as vendor_name,
  line.item_number,
  coalesce(nullif(line.product_name, ''), item.value ->> 'product_name') as product_name,
  count(*)::integer as sample_count,
  round(avg(extract(epoch from (receipt.received_at - po.created_at)) / 86400.0)::numeric, 2) as average_days,
  round(min(extract(epoch from (receipt.received_at - po.created_at)) / 86400.0)::numeric, 2) as minimum_days,
  round(max(extract(epoch from (receipt.received_at - po.created_at)) / 86400.0)::numeric, 2) as maximum_days,
  max(receipt.received_at) as latest_received_at
from public.purchase_orders po
join public.po_receipts receipt
  on receipt.purchase_order_id = po.id
join public.po_receiving_lines line
  on line.receipt_id = receipt.id
left join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) as item(value)
  on (
    (item.value ->> 'line_no')::integer = line.line_no
    or coalesce(item.value ->> 'item_number', '') = coalesce(line.item_number, '')
  )
where po.workflow_kind = 'vendor_order'
group by
  po.vendor_id,
  po.vendor,
  line.item_number,
  coalesce(nullif(line.product_name, ''), item.value ->> 'product_name');

-- 6. Explicit grants for backend service-role access on newly created tables.
grant select, insert, update, delete on table public.po_invoice_scans to service_role;
grant select, insert, update, delete on table public.po_receipts to service_role;
grant select, insert, update, delete on table public.po_receiving_lines to service_role;
grant select, insert, update, delete on table public.po_discrepancy_log to service_role;
grant select, insert, update, delete on table public.po_receiving_approval_queue to service_role;
grant select on table public.vendor_lead_times to service_role;

-- 7. Row-level security for the new public tables. The backend uses
--    service_role, which bypasses RLS, while direct client access remains
--    locked down until explicit policies are added.
alter table public.po_invoice_scans enable row level security;
alter table public.po_receipts enable row level security;
alter table public.po_receiving_lines enable row level security;
alter table public.po_discrepancy_log enable row level security;
alter table public.po_receiving_approval_queue enable row level security;
