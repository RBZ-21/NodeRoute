-- ================================================================
-- Migration: company_config + products (multi-vertical SaaS)
-- 2026-05-10
-- ================================================================

-- ── company_config ────────────────────────────────────────────────────────────
-- One row per company, stores onboarding wizard selections and feature flags.
-- All UI field visibility is driven from this table via the useCompanyConfig hook.

CREATE TABLE IF NOT EXISTS company_config (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Step 1: business verticals (multi-select)
  business_types         text[]      NOT NULL DEFAULT '{}',
  -- valid values: seafood | meat | produce | dairy | liquor | paper | broadline | wholesale

  -- Step 2: unit-of-measure preferences (multi-select)
  enabled_units          text[]      NOT NULL DEFAULT '{}',
  -- valid values: each | case | lb | catch_weight | gallon | pallet

  -- Step 3: feature flags (toggled during onboarding, overridable by superadmin)
  feat_catch_weight      boolean     NOT NULL DEFAULT false,
  feat_fsma_lot_tracking boolean     NOT NULL DEFAULT false,
  feat_cold_chain_notes  boolean     NOT NULL DEFAULT false,
  feat_alcohol_compliance boolean    NOT NULL DEFAULT false,
  feat_deposit_tracking  boolean     NOT NULL DEFAULT false,
  feat_case_to_each      boolean     NOT NULL DEFAULT false,

  -- Step 4: catalog setup
  catalog_template       text        NOT NULL DEFAULT 'blank',
  -- valid values: seafood | liquor | produce | paper_goods | broadline | blank
  catalog_setup          text        NOT NULL DEFAULT 'blank',
  -- valid values: template | csv | blank

  onboarding_completed   boolean     NOT NULL DEFAULT false,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT company_config_company_id_unique UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS company_config_company_id_idx ON company_config (company_id);

-- ── products ──────────────────────────────────────────────────────────────────
-- Flexible, multi-vertical product catalog that replaces seafood_inventory.
-- Maintains full backward compatibility: description = name in API responses,
-- item_number remains the business key, all original columns are preserved.

CREATE TABLE IF NOT EXISTS products (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id              uuid        REFERENCES locations(id) ON DELETE SET NULL,

  -- Identity (item_number = legacy business key; sku = new optional alias)
  item_number              text        NOT NULL,
  name                     text        NOT NULL,          -- "description" in legacy API
  sku                      text,
  category                 text        NOT NULL DEFAULT 'General',

  -- Unit configuration
  default_unit             text        NOT NULL DEFAULT 'each'
                             CHECK (default_unit IN ('each','case','lb','catch_weight','gallon','pallet')),
  case_qty                 numeric,                       -- how many eaches per case

  -- Pricing
  price_per_unit           numeric     NOT NULL DEFAULT 0,
  cost                     numeric     NOT NULL DEFAULT 0,

  -- Stock levels
  on_hand_qty              numeric     NOT NULL DEFAULT 0,
  on_hand_weight           numeric     NOT NULL DEFAULT 0,

  -- Legacy compatibility columns kept to avoid breaking the inventory API
  unit                     text        NOT NULL DEFAULT 'lb', -- historical unit label shown in UI
  lot_item                 text        NOT NULL DEFAULT 'N',  -- 'Y' | 'N' lot-required flag

  -- Product-level feature flags (drive per-item field visibility)
  is_catch_weight          boolean     NOT NULL DEFAULT false,
  is_ftl_regulated         boolean     NOT NULL DEFAULT false, -- FSMA 204 lot tracking required
  is_deposit_item          boolean     NOT NULL DEFAULT false,
  deposit_amount           numeric,
  requires_age_verification boolean    NOT NULL DEFAULT false, -- alcohol 21+
  temp_sensitive           boolean     NOT NULL DEFAULT false,

  -- Analytics (carried over from seafood_inventory enhancements)
  avg_yield                numeric,
  yield_count              integer     DEFAULT 0,
  is_active                boolean     NOT NULL DEFAULT true,
  alert_sent_at            timestamptz,

  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT products_company_item_unique UNIQUE (company_id, item_number)
);

-- Backward-compat alias: expose `description` so existing queries that
-- SELECT description FROM products work without any query changes.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description TEXT GENERATED ALWAYS AS (name) STORED;

CREATE INDEX IF NOT EXISTS products_company_id_idx  ON products (company_id);
CREATE INDEX IF NOT EXISTS products_location_id_idx ON products (location_id);
CREATE INDEX IF NOT EXISTS products_category_idx    ON products (company_id, category);
CREATE INDEX IF NOT EXISTS products_is_active_idx   ON products (company_id, is_active);

-- ── Migrate seafood_inventory → products ──────────────────────────────────────
-- Run only if seafood_inventory exists (safe for fresh installs).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'seafood_inventory'
  ) THEN
    INSERT INTO products (
      company_id, location_id,
      item_number, name, category,
      default_unit, unit, cost, price_per_unit,
      on_hand_qty, on_hand_weight,
      lot_item, is_catch_weight, is_ftl_regulated,
      avg_yield, yield_count, is_active,
      notes, created_at
    )
    SELECT
      company_id,
      location_id,
      item_number,
      description,                          -- name ← description
      COALESCE(category, 'General'),
      CASE COALESCE(unit, 'lb')             -- default_unit normalised
        WHEN 'lb'    THEN 'lb'
        WHEN 'case'  THEN 'case'
        WHEN 'each'  THEN 'each'
        WHEN 'gal'   THEN 'gallon'
        WHEN 'pallet' THEN 'pallet'
        ELSE 'lb'
      END,
      COALESCE(unit, 'lb'),                 -- unit preserved as-is
      COALESCE(cost, 0),
      COALESCE(cost, 0),                    -- price_per_unit = cost initially
      COALESCE(on_hand_qty, 0),
      COALESCE(on_hand_weight, 0),
      COALESCE(lot_item, 'N'),
      COALESCE(is_catch_weight, false),
      COALESCE(is_ftl_product, false),
      avg_yield,
      COALESCE(yield_count, 0),
      COALESCE(is_active, true),
      notes,
      COALESCE(created_at, now())
    FROM seafood_inventory
    ON CONFLICT (company_id, item_number) DO NOTHING;
  END IF;
END $$;

-- ── backward-compat view (optional — inventory.js now queries products directly) ─
CREATE OR REPLACE VIEW seafood_inventory_view AS
  SELECT
    id,
    company_id,
    location_id,
    item_number,
    name          AS description,
    category,
    unit,
    cost,
    on_hand_qty,
    on_hand_weight,
    lot_item,
    is_catch_weight,
    is_ftl_regulated AS is_ftl_product,
    avg_yield,
    yield_count,
    is_active,
    alert_sent_at,
    notes,
    created_at,
    updated_at
  FROM products;

-- ── Default company_config for existing seafood tenant ────────────────────────
INSERT INTO company_config (
  company_id,
  business_types,
  enabled_units,
  feat_catch_weight,
  feat_fsma_lot_tracking,
  feat_cold_chain_notes,
  feat_alcohol_compliance,
  feat_deposit_tracking,
  feat_case_to_each,
  catalog_template,
  catalog_setup,
  onboarding_completed
)
SELECT
  id,
  ARRAY['seafood'],
  ARRAY['lb', 'catch_weight', 'case'],
  true,   -- catch weight
  true,   -- FSMA 204
  true,   -- cold chain notes
  false,  -- alcohol compliance
  false,  -- deposit tracking
  false,  -- case-to-each
  'seafood',
  'template',
  true    -- skip onboarding for existing tenant
FROM companies
WHERE id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (company_id) DO NOTHING;

-- Also seed a default config for any other existing companies that don't have one,
-- marking them as needing onboarding.
INSERT INTO company_config (
  company_id, business_types, enabled_units,
  feat_catch_weight, feat_fsma_lot_tracking, feat_cold_chain_notes,
  feat_alcohol_compliance, feat_deposit_tracking, feat_case_to_each,
  catalog_template, catalog_setup, onboarding_completed
)
SELECT
  c.id,
  ARRAY[]::text[],
  ARRAY[]::text[],
  false, false, false, false, false, false,
  'blank', 'blank', false
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_config cc WHERE cc.company_id = c.id
)
ON CONFLICT (company_id) DO NOTHING;
