-- Replace the old seafood_inventory_view with a view named seafood_inventory so any
-- remaining dynamic references (string-interpolated table names, raw SQL, etc.) keep
-- working while all hard-coded code references have been migrated to products.
DROP VIEW IF EXISTS seafood_inventory_view;

CREATE OR REPLACE VIEW seafood_inventory AS
  SELECT
    id,
    company_id,
    location_id,
    item_number,
    name          AS description,
    name,
    category,
    unit,
    cost,
    price_per_unit,
    on_hand_qty,
    on_hand_weight,
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
  FROM products;
