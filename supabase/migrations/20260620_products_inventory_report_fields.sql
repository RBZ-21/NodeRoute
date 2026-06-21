-- Add Entree Inventory On Hand Report fields to the product catalog.
-- These names map directly to the report labels while preserving the
-- existing product columns used by orders, ledger, reporting, and warehouse.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS description_line_1 text,
  ADD COLUMN IF NOT EXISTS class_name text,
  ADD COLUMN IF NOT EXISTS cost_base numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_real numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS on_hand_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_at_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_at_level_1 numeric NOT NULL DEFAULT 0;

UPDATE public.products
SET
  description_line_1 = COALESCE(NULLIF(description_line_1, ''), name),
  class_name = COALESCE(NULLIF(class_name, ''), category),
  cost_base = CASE
    WHEN cost_base = 0 AND COALESCE(base_cost, cost, 0) <> 0 THEN COALESCE(base_cost, cost, 0)
    ELSE cost_base
  END,
  cost_real = CASE
    WHEN cost_real = 0 AND COALESCE(real_cost, cost, 0) <> 0 THEN COALESCE(real_cost, cost, 0)
    ELSE cost_real
  END,
  on_hand_quantity = CASE
    WHEN on_hand_quantity = 0 AND COALESCE(on_hand_qty, 0) <> 0 THEN COALESCE(on_hand_qty, 0)
    ELSE on_hand_quantity
  END;

CREATE OR REPLACE FUNCTION public.sync_products_inventory_report_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NULLIF(NEW.description_line_1, '') IS NULL
    OR (
      TG_OP = 'UPDATE'
      AND NEW.name IS DISTINCT FROM OLD.name
      AND NEW.description_line_1 IS NOT DISTINCT FROM OLD.description_line_1
    )
  THEN
    NEW.description_line_1 := NEW.name;
  END IF;
  IF (NEW.name IS NULL OR NEW.name = '')
    OR (
      TG_OP = 'UPDATE'
      AND NEW.description_line_1 IS DISTINCT FROM OLD.description_line_1
      AND NEW.name IS NOT DISTINCT FROM OLD.name
    )
  THEN
    NEW.name := NEW.description_line_1;
  END IF;

  IF NULLIF(NEW.class_name, '') IS NULL
    OR (
      TG_OP = 'UPDATE'
      AND NEW.category IS DISTINCT FROM OLD.category
      AND NEW.class_name IS NOT DISTINCT FROM OLD.class_name
    )
  THEN
    NEW.class_name := NEW.category;
  END IF;
  IF (NEW.category IS NULL OR NEW.category = '')
    OR (
      TG_OP = 'UPDATE'
      AND NEW.class_name IS DISTINCT FROM OLD.class_name
      AND NEW.category IS NOT DISTINCT FROM OLD.category
    )
  THEN
    NEW.category := NEW.class_name;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.cost_base IS DISTINCT FROM OLD.cost_base THEN
    NEW.base_cost := NEW.cost_base;
    NEW.cost := NEW.cost_base;
    NEW.price_per_unit := NEW.cost_base;
  ELSIF TG_OP = 'UPDATE' AND NEW.base_cost IS DISTINCT FROM OLD.base_cost THEN
    NEW.cost_base := NEW.base_cost;
    NEW.cost := NEW.base_cost;
    NEW.price_per_unit := NEW.base_cost;
  ELSIF TG_OP = 'UPDATE' AND NEW.cost IS DISTINCT FROM OLD.cost THEN
    NEW.cost_base := NEW.cost;
    NEW.base_cost := NEW.cost;
    NEW.price_per_unit := NEW.cost;
  END IF;

  IF NEW.cost_base IS NULL
    OR (TG_OP = 'INSERT' AND NEW.cost_base = 0 AND COALESCE(NEW.base_cost, NEW.cost, 0) <> 0)
  THEN
    NEW.cost_base := COALESCE(NEW.base_cost, NEW.cost, 0);
  END IF;
  IF NEW.base_cost IS NULL OR (NEW.base_cost = 0 AND NEW.cost_base <> 0) THEN
    NEW.base_cost := NEW.cost_base;
  END IF;
  IF NEW.cost IS NULL OR (NEW.cost = 0 AND NEW.cost_base <> 0) THEN
    NEW.cost := NEW.cost_base;
  END IF;
  IF NEW.price_per_unit IS NULL OR (NEW.price_per_unit = 0 AND NEW.cost_base <> 0) THEN
    NEW.price_per_unit := NEW.cost_base;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.cost_real IS DISTINCT FROM OLD.cost_real THEN
    NEW.real_cost := NEW.cost_real;
  ELSIF TG_OP = 'UPDATE' AND NEW.real_cost IS DISTINCT FROM OLD.real_cost THEN
    NEW.cost_real := NEW.real_cost;
  END IF;

  IF NEW.cost_real IS NULL
    OR (TG_OP = 'INSERT' AND NEW.cost_real = 0 AND COALESCE(NEW.real_cost, NEW.cost_base, NEW.cost, 0) <> 0)
  THEN
    NEW.cost_real := COALESCE(NEW.real_cost, NEW.cost_base, NEW.cost, 0);
  END IF;
  IF NEW.real_cost IS NULL OR (NEW.real_cost = 0 AND NEW.cost_real <> 0) THEN
    NEW.real_cost := NEW.cost_real;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.on_hand_quantity IS DISTINCT FROM OLD.on_hand_quantity THEN
    NEW.on_hand_qty := NEW.on_hand_quantity;
  ELSIF TG_OP = 'UPDATE' AND NEW.on_hand_qty IS DISTINCT FROM OLD.on_hand_qty THEN
    NEW.on_hand_quantity := NEW.on_hand_qty;
  END IF;

  IF NEW.on_hand_quantity IS NULL
    OR (TG_OP = 'INSERT' AND NEW.on_hand_quantity = 0 AND COALESCE(NEW.on_hand_qty, 0) <> 0)
  THEN
    NEW.on_hand_quantity := COALESCE(NEW.on_hand_qty, 0);
  END IF;
  IF NEW.on_hand_qty IS NULL OR (NEW.on_hand_qty = 0 AND NEW.on_hand_quantity <> 0) THEN
    NEW.on_hand_qty := NEW.on_hand_quantity;
  END IF;

  NEW.allocated_quantity := COALESCE(NEW.allocated_quantity, 0);
  NEW.value_at_cost := COALESCE(NEW.value_at_cost, 0);
  NEW.value_at_level_1 := COALESCE(NEW.value_at_level_1, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_inventory_report_fields ON public.products;
CREATE TRIGGER trg_products_inventory_report_fields
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_products_inventory_report_fields();

COMMENT ON COLUMN public.products.description_line_1 IS 'Entree Inventory On Hand Report: Description Line 1.';
COMMENT ON COLUMN public.products.class_name IS 'Entree Inventory On Hand Report: Class Name.';
COMMENT ON COLUMN public.products.cost_base IS 'Entree Inventory On Hand Report: Cost: Base.';
COMMENT ON COLUMN public.products.cost_real IS 'Entree Inventory On Hand Report: Cost: Real.';
COMMENT ON COLUMN public.products.allocated_quantity IS 'Entree Inventory On Hand Report: Allocated Quantity.';
COMMENT ON COLUMN public.products.on_hand_quantity IS 'Entree Inventory On Hand Report: On Hand Quantity.';
COMMENT ON COLUMN public.products.value_at_cost IS 'Entree Inventory On Hand Report: Value at Cost.';
COMMENT ON COLUMN public.products.value_at_level_1 IS 'Entree Inventory On Hand Report: Value at Level 1.';

DROP VIEW IF EXISTS public.seafood_inventory_view;
DROP VIEW IF EXISTS public.seafood_inventory;

CREATE VIEW public.seafood_inventory
WITH (security_invoker = true) AS
  SELECT
    id,
    company_id,
    location_id,
    item_number,
    name AS description,
    description_line_1,
    name,
    category,
    class_name,
    unit,
    cost,
    base_cost,
    cost_base,
    landed_cost,
    lot_cost,
    market_cost,
    real_cost,
    cost_real,
    price_per_unit,
    allocated_quantity,
    on_hand_qty,
    on_hand_quantity,
    on_hand_weight,
    value_at_cost,
    value_at_level_1,
    lot_item,
    is_catch_weight,
    is_ftl_regulated AS is_ftl_product,
    is_ftl_regulated,
    avg_yield,
    yield_count,
    is_active,
    alert_sent_at,
    notes,
    created_at,
    updated_at
  FROM public.products;
