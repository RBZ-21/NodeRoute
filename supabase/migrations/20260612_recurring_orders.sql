-- ============================================================================
-- Recurring (standing) orders
-- ----------------------------------------------------------------------------
-- Customers on a standing schedule (e.g. "every Mon/Wed/Fri") get real orders
-- generated automatically the evening before each scheduled day, optionally
-- pre-assigned to a route template.
--
-- Schema notes:
--   * company_id is TEXT (matching the newer tenant-scoped tables such as
--     credit_hold_log / ai_insights and the 20260528 RLS sweep convention).
--   * customer_id is TEXT (no FK) because "Customers".id is BIGINT in this
--     deployment but order/customer linkage elsewhere is stored loosely.
--   * schedule_days is an int[] of ISO weekday numbers (0=Sun … 6=Sat).
--   * items is jsonb: [{ item_number, name, unit, quantity, unit_price }].
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS recurring_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT,
  customer_id       TEXT,
  customer_name     TEXT,
  customer_email    TEXT,
  customer_address  TEXT,
  schedule_days     INTEGER[] NOT NULL DEFAULT '{}',
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_template_id TEXT,
  notes             TEXT,
  active            BOOLEAN NOT NULL DEFAULT true,
  next_run_date     DATE,
  last_generated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_orders_company ON recurring_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_orders_active_next
  ON recurring_orders(active, next_run_date) WHERE active = true;

-- Idempotency for the generator: at most one generated order per recurring
-- template per delivery date. The job also checks before inserting, but this
-- guarantees no duplicates under concurrent runs.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurring_order_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurring_run_date DATE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_recurring_run
  ON orders(recurring_order_id, recurring_run_date)
  WHERE recurring_order_id IS NOT NULL;

-- ── RLS: tenant-scoped, matching the 20260528 security sweep ───────────────
ALTER TABLE recurring_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recurring_orders: tenant scoped" ON recurring_orders;
CREATE POLICY "recurring_orders: tenant scoped"
  ON recurring_orders
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin() OR company_id::text = public.auth_company_id_text())
  WITH CHECK (public.is_platform_admin() OR company_id::text = public.auth_company_id_text());
