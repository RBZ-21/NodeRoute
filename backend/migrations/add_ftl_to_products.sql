-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_ftl_to_products
-- Purpose  : Flag products that appear on the FDA Food Traceability List (FTL).
--            When is_ftl_product = TRUE, lot assignment becomes required on
--            every order line item for that product (enforced by the API).
--
-- Products are stored in the seafood_inventory table.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE seafood_inventory
  ADD COLUMN IF NOT EXISTS is_ftl_product BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_seafood_inv_ftl
  ON seafood_inventory (is_ftl_product)
  WHERE is_ftl_product = TRUE;
