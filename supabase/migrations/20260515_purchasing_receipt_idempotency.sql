-- Harden purchasing receipt idempotency and auto-generated vendor bill uniqueness.

alter table if exists public.purchase_orders
  add column if not exists source_request_id text;

with ranked_scan_receipts as (
  select
    id,
    source_scan_id,
    row_number() over (
      partition by company_id, source_scan_id
      order by created_at asc, id asc
    ) as rn
  from public.purchase_orders
  where workflow_kind = 'inventory_receipt'
    and source_scan_id is not null
    and (source_request_id is null or btrim(source_request_id) = '')
)
update public.purchase_orders po
set source_request_id = concat('scan:', ranked_scan_receipts.source_scan_id::text)
from ranked_scan_receipts
where po.id = ranked_scan_receipts.id
  and ranked_scan_receipts.rn = 1;

create unique index if not exists idx_purchase_orders_inventory_receipt_request_unique
  on public.purchase_orders(company_id, source_request_id)
  where workflow_kind = 'inventory_receipt'
    and source_request_id is not null
    and btrim(source_request_id) <> '';

alter table if exists public.po_receipts
  add column if not exists receipt_request_id text;

with ranked_po_receipts as (
  select
    id,
    purchase_order_id,
    scan_id,
    row_number() over (
      partition by purchase_order_id, scan_id
      order by received_at asc, id asc
    ) as rn
  from public.po_receipts
  where scan_id is not null
    and (receipt_request_id is null or btrim(receipt_request_id) = '')
)
update public.po_receipts receipt
set receipt_request_id = concat('scan:', ranked_po_receipts.scan_id::text)
from ranked_po_receipts
where receipt.id = ranked_po_receipts.id
  and ranked_po_receipts.rn = 1;

create unique index if not exists idx_po_receipts_request_unique
  on public.po_receipts(purchase_order_id, receipt_request_id)
  where receipt_request_id is not null
    and btrim(receipt_request_id) <> '';

with duplicate_auto_bills as (
  select
    id,
    purchase_order_id,
    row_number() over (
      partition by purchase_order_id
      order by created_at asc, id asc
    ) as rn
  from public.vendor_bills
  where auto_generated is true
    and purchase_order_id is not null
)
update public.vendor_bills bill
set
  auto_generated = false,
  notes = case
    when coalesce(bill.notes, '') = '' then 'Preserved duplicate auto-generated bill during idempotency hardening.'
    else 'Preserved duplicate auto-generated bill during idempotency hardening. ' || bill.notes
  end
from duplicate_auto_bills
where bill.id = duplicate_auto_bills.id
  and duplicate_auto_bills.rn > 1;

create unique index if not exists idx_vendor_bills_auto_generated_po_unique
  on public.vendor_bills(purchase_order_id)
  where auto_generated is true
    and purchase_order_id is not null;
