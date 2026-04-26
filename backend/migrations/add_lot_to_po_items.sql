-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_lot_to_po_items
-- Purpose  : FSMA 204 — capture lot_number and expiration_date at the point of
--            receiving (purchase order confirmation).
--
-- Schema note: PO line items are stored as JSONB objects in purchase_orders.items[].
-- Each item object gains two fields at the application layer:
--   lot_number      TEXT — vendor-assigned lot identifier (stored verbatim)
--   expiration_date TEXT — ISO-8601 date string (e.g. "2026-05-15"), optional
--
-- Example item object after this migration:
--   {
--     "description": "Atlantic Salmon",
--     "quantity": 200,
--     "unit_price": 10.50,
--     "unit": "lb",
--     "lot_number": "SALMON-2026-001",
--     "expiration_date": "2026-05-15"
--   }
--
-- The GIN index below enables queries such as:
--   SELECT * FROM purchase_orders WHERE items @> '[{"lot_number": "SALMON-2026-001"}]';
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_purchase_orders_items_gin
  ON purchase_orders USING GIN (items);
