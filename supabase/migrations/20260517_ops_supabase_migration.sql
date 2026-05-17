-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260517_ops_supabase_migration
-- Purpose  : Replace the backend/data/ops.json flat-file store with proper
--            Supabase tables. The file store is non-multi-tenant, ephemeral on
--            container deploys, and not concurrent-safe.
--            Also creates the warehouse support tables that warehouse.js has
--            been querying without a backing schema.
--
-- This migration is fully idempotent: tables are created with IF NOT EXISTS,
-- and tenant scope columns (company_id, location_id) are added via
-- ADD COLUMN IF NOT EXISTS so RLS policies always have a valid column to
-- reference, even when tables already exist from earlier ad-hoc creation.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── op_uom_rules ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS op_uom_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  from_unit    text NOT NULL,
  to_unit      text NOT NULL,
  factor       numeric NOT NULL CHECK (factor > 0),
  notes        text,
  company_id   uuid,
  location_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE op_uom_rules ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE op_uom_rules ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS op_uom_rules_company_idx
  ON op_uom_rules(company_id);

-- ── op_warehouses ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS op_warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  company_id  uuid,
  location_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE op_warehouses ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE op_warehouses ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS op_warehouses_company_idx
  ON op_warehouses(company_id);

-- ── op_cycle_counts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS op_cycle_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  text,
  replace_stock boolean NOT NULL DEFAULT false,
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb,
  counted_by    text,
  counted_at    timestamptz NOT NULL DEFAULT now(),
  company_id    uuid,
  location_id   uuid
);
ALTER TABLE op_cycle_counts ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE op_cycle_counts ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS op_cycle_counts_company_counted_idx
  ON op_cycle_counts(company_id, counted_at DESC);

-- ── op_returns ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS op_returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  product_name  text NOT NULL,
  quantity      numeric NOT NULL DEFAULT 0,
  reason        text,
  status        text NOT NULL DEFAULT 'open',
  company_id    uuid,
  location_id   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE op_returns ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE op_returns ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS op_returns_company_created_idx
  ON op_returns(company_id, created_at DESC);

-- ── op_barcode_events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS op_barcode_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,
  action       text NOT NULL DEFAULT 'scan',
  quantity     numeric NOT NULL DEFAULT 0,
  item_name    text,
  warehouse_id text,
  created_by   text,
  company_id   uuid,
  location_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE op_barcode_events ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE op_barcode_events ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS op_barcode_events_company_created_idx
  ON op_barcode_events(company_id, created_at DESC);

-- ── op_edi_jobs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS op_edi_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction   text NOT NULL,
  partner     text NOT NULL,
  doc_type    text NOT NULL,
  status      text NOT NULL DEFAULT 'queued',
  company_id  uuid,
  location_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE op_edi_jobs ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE op_edi_jobs ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS op_edi_jobs_company_idx
  ON op_edi_jobs(company_id, status);

-- ── op_po_drafts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS op_po_drafts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_number         text NOT NULL,
  status               text NOT NULL DEFAULT 'draft',
  vendor               text,
  notes                text,
  source               jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines                jsonb NOT NULL DEFAULT '[]'::jsonb,
  line_count           integer NOT NULL DEFAULT 0,
  total_suggested_qty  numeric NOT NULL DEFAULT 0,
  total_estimated_cost numeric NOT NULL DEFAULT 0,
  linked_vendor_po_id  uuid,
  created_by           text,
  updated_by           text,
  company_id           uuid,
  location_id          uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE op_po_drafts ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE op_po_drafts ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE op_po_drafts ADD COLUMN IF NOT EXISTS linked_vendor_po_id uuid;
CREATE INDEX IF NOT EXISTS op_po_drafts_company_created_idx
  ON op_po_drafts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS op_po_drafts_status_idx
  ON op_po_drafts(status);

-- ── warehouse_locations (closes audit P1-6) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL,
  notes       text,
  status      text NOT NULL DEFAULT 'active',
  company_id  uuid,
  location_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS company_id  uuid;
ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS notes       text;
ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS warehouse_locations_company_idx
  ON warehouse_locations(company_id);

-- ── warehouse_scans ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_scans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_number  text NOT NULL,
  action       text NOT NULL,
  quantity     numeric,
  unit         text,
  location_id  uuid,
  lot_number   text,
  notes        text,
  performed_by uuid,
  company_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE warehouse_scans ADD COLUMN IF NOT EXISTS company_id   uuid;
ALTER TABLE warehouse_scans ADD COLUMN IF NOT EXISTS location_id  uuid;
ALTER TABLE warehouse_scans ADD COLUMN IF NOT EXISTS unit         text;
ALTER TABLE warehouse_scans ADD COLUMN IF NOT EXISTS lot_number   text;
ALTER TABLE warehouse_scans ADD COLUMN IF NOT EXISTS notes        text;
ALTER TABLE warehouse_scans ADD COLUMN IF NOT EXISTS performed_by uuid;
CREATE INDEX IF NOT EXISTS warehouse_scans_company_created_idx
  ON warehouse_scans(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS warehouse_scans_item_idx
  ON warehouse_scans(item_number);

-- ── warehouse_returns ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_returns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid,
  customer_name    text,
  item_number      text NOT NULL,
  item_description text,
  quantity         numeric NOT NULL,
  unit             text,
  reason           text NOT NULL,
  lot_number       text,
  notes            text,
  status           text NOT NULL DEFAULT 'open',
  resolution       text,
  restocked        boolean NOT NULL DEFAULT false,
  reported_by      uuid,
  company_id       uuid,
  location_id      uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS company_id       uuid;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS location_id      uuid;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS customer_id      uuid;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS customer_name    text;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS item_description text;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS unit             text;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS lot_number       text;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS notes            text;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'open';
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS resolution       text;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS restocked        boolean NOT NULL DEFAULT false;
ALTER TABLE warehouse_returns ADD COLUMN IF NOT EXISTS reported_by      uuid;
CREATE INDEX IF NOT EXISTS warehouse_returns_company_status_idx
  ON warehouse_returns(company_id, status);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Service-role key (used by the backend) bypasses RLS. These policies harden
-- the tables against future client-side access via the anon key.
--
-- Per-table loop: enables RLS, drops any prior policy with the same name, then
-- creates the tenant-isolation policy. Wrapped in a DO block so the column
-- existence checks above are guaranteed to have already run.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'op_uom_rules',
    'op_warehouses',
    'op_cycle_counts',
    'op_returns',
    'op_barcode_events',
    'op_edi_jobs',
    'op_po_drafts',
    'warehouse_locations',
    'warehouse_scans',
    'warehouse_returns'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Safety: verify company_id exists before touching policies. Skip + warn
    -- if it somehow doesn't (e.g., the table was renamed under us).
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'company_id'
    ) THEN
      RAISE WARNING 'Skipping RLS on %: company_id column missing', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I', tbl, tbl);
    EXECUTE format($p$
      CREATE POLICY %I_tenant_isolation ON %I
        FOR ALL USING (
          company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
          OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
        )
    $p$, tbl, tbl);
  END LOOP;
END $$;
