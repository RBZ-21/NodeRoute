-- FSMA / Catch Weight: order line item JSONB schema extension
-- orders.items is a JSONB array — no ALTER TABLE required.
-- Each item object may now include the following catch weight fields:
--
--   is_catch_weight     BOOLEAN     default false
--   estimated_weight    NUMERIC(8,3) nullable — weight quoted at order time
--   actual_weight       NUMERIC(8,3) nullable — measured weight captured by warehouse
--   price_per_lb        NUMERIC(10,4) nullable — per-pound price for this line
--   weight_variance     COMPUTED: actual_weight - estimated_weight (never stored)
--
-- Non-catch-weight items are unchanged (quantity / unit_price / unit fields remain).
-- GIN index already created in add_lot_to_order_items.sql supports containment
-- queries on the items array. No additional index needed for catch weight fields.

-- Ensure GIN index exists (idempotent)
CREATE INDEX IF NOT EXISTS idx_orders_items_gin ON orders USING GIN (items);

-- Add estimated_weight_pending flag to invoices so billing knows when weights are outstanding.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS estimated_weight_pending BOOLEAN NOT NULL DEFAULT FALSE;
