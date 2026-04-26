-- Catch weight product flags on seafood_inventory
-- is_catch_weight: true means this product is sold by actual measured weight.
-- default_price_per_lb: pre-fills the price/lb field when adding to an order.

ALTER TABLE seafood_inventory
  ADD COLUMN IF NOT EXISTS is_catch_weight    BOOLEAN        NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_price_per_lb NUMERIC(10,4);

CREATE INDEX IF NOT EXISTS idx_seafood_inv_catch_weight
  ON seafood_inventory (is_catch_weight)
  WHERE is_catch_weight = TRUE;
