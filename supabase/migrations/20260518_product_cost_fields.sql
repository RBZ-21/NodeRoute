-- Adds 5 cost-tracking columns to products to mirror the Entrée cost model.
-- base_cost    : standard purchase cost from the vendor
-- landed_cost  : base + freight, duties, handling to warehouse
-- lot_cost     : actual cost tied to the most recent lot/batch received
-- market_cost  : current market reference price (used for repricing)
-- real_cost    : true all-in cost after overrides / catch-weight reconciliation
--
-- The legacy `cost` column is preserved unchanged; on first deploy it is
-- treated as the canonical base cost and copied forward so existing reports
-- keep working.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS base_cost   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landed_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lot_cost    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS real_cost   numeric NOT NULL DEFAULT 0;

-- Backfill: existing `cost` rows become the starting value for every new
-- column so margin math stays consistent until the user enters real numbers.
UPDATE public.products
SET
  base_cost   = COALESCE(NULLIF(base_cost,   0), cost, 0),
  landed_cost = COALESCE(NULLIF(landed_cost, 0), cost, 0),
  lot_cost    = COALESCE(NULLIF(lot_cost,    0), cost, 0),
  market_cost = COALESCE(NULLIF(market_cost, 0), cost, 0),
  real_cost   = COALESCE(NULLIF(real_cost,   0), cost, 0)
WHERE cost IS NOT NULL;
