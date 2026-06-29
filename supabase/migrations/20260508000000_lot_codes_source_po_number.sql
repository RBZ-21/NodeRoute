-- Tie FSMA/traceability lots back to the originating vendor PO.
alter table if exists lot_codes
  add column if not exists source_po_number text;

create index if not exists idx_lot_codes_source_po_number
  on lot_codes(source_po_number);
