-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_lot_to_order_items
-- Purpose  : FSMA 204 — link order line items to lot_codes records.
--
-- Schema note: Order line items are stored as JSONB objects in orders.items[].
-- Each item object gains two fields at the application layer:
--   lot_id            INTEGER  — foreign key into lot_codes.id
--   quantity_from_lot NUMERIC  — quantity pulled from that specific lot
--
-- Example item object after this migration:
--   {
--     "name": "Atlantic Salmon",
--     "item_number": "SAL-01",
--     "unit": "lb",
--     "requested_weight": 50,
--     "unit_price": 12.99,
--     "lot_id": 1,
--     "lot_number": "SALMON-2026-001",
--     "quantity_from_lot": 50
--   }
--
-- The GIN index below enables efficient traceability queries such as:
--   SELECT * FROM orders WHERE items @> '[{"lot_id": 1}]';
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_items_gin
  ON orders USING GIN (items);
