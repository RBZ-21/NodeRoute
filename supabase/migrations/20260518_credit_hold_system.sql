-- ============================================================================
-- Credit Hold System
-- ----------------------------------------------------------------------------
-- Adds credit limit / terms / balance tracking to Customers and creates two
-- supporting tables:
--   credit_hold_log        — append-only audit trail of every credit event
--   credit_hold_overrides  — manager-issued passes that let a single order
--                            through despite an active hold
--
-- Schema notes:
--   * The Customers table is mixed-case ("Customers") and Customers.id is
--     an integer column in this deployment, so FKs use BIGINT.
--   * order_id / invoice_id are stored as TEXT with no FK so the audit log
--     remains valid across deployments where those PKs may be UUID or BIGINT.
--   * Existing columns (credit_hold, credit_hold_reason, credit_hold_placed_at,
--     payment_terms) are NOT duplicated — the credit engine writes to them.
-- ============================================================================

-- pgcrypto provides gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1A. Customer credit columns ────────────────────────────────────────────
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS credit_terms VARCHAR(30);
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS current_balance DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS credit_status VARCHAR(20) DEFAULT 'good';
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS hold_placed_by UUID REFERENCES users(id);
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS hold_notes TEXT;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS auto_hold_enabled BOOLEAN DEFAULT true;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS warning_threshold_pct DECIMAL(5,2) DEFAULT 80.00;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS last_payment_date DATE;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS last_payment_amount DECIMAL(12,2);
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS avg_days_to_pay INTEGER DEFAULT 0;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS payment_count INTEGER DEFAULT 0;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS oldest_unpaid_invoice_date DATE;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS credit_reviewed_at TIMESTAMPTZ;
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS credit_reviewed_by UUID REFERENCES users(id);

-- credit_status: 'good' | 'warning' | 'hold' | 'suspended' | 'prepay_only'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'customers_credit_status_chk'
  ) THEN
    ALTER TABLE "Customers" ADD CONSTRAINT customers_credit_status_chk
      CHECK (credit_status IN ('good','warning','hold','suspended','prepay_only'));
  END IF;
END$$;

-- ── 1B. credit_hold_log (append-only) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_hold_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                 BIGINT NOT NULL REFERENCES "Customers"(id) ON DELETE CASCADE,
  event_type                  VARCHAR(30) NOT NULL,
  previous_status             VARCHAR(20),
  new_status                  VARCHAR(20),
  previous_credit_limit       DECIMAL(12,2),
  new_credit_limit            DECIMAL(12,2),
  previous_credit_terms       VARCHAR(30),
  new_credit_terms            VARCHAR(30),
  customer_balance_at_event   DECIMAL(12,2),
  triggered_by                VARCHAR(20),
  performed_by                UUID REFERENCES users(id),
  order_id                    TEXT,
  invoice_id                  TEXT,
  override_reason             TEXT,
  notes                       TEXT,
  company_id                  TEXT,
  location_id                 TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chl_customer    ON credit_hold_log(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chl_event_type  ON credit_hold_log(event_type);
CREATE INDEX IF NOT EXISTS idx_chl_performed_by ON credit_hold_log(performed_by);
CREATE INDEX IF NOT EXISTS idx_chl_created_at  ON credit_hold_log(created_at DESC);

-- Append-only enforcement: block UPDATEs and DELETEs at the database level.
-- This is a financial audit trail. Inserts only.
CREATE OR REPLACE FUNCTION credit_hold_log_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit_hold_log is append-only — % is not permitted', TG_OP;
END$$;

DROP TRIGGER IF EXISTS trg_credit_hold_log_no_update ON credit_hold_log;
CREATE TRIGGER trg_credit_hold_log_no_update
  BEFORE UPDATE OR DELETE ON credit_hold_log
  FOR EACH ROW EXECUTE FUNCTION credit_hold_log_block_mutation();

-- ── 1C. credit_hold_overrides ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_hold_overrides (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                   BIGINT NOT NULL REFERENCES "Customers"(id) ON DELETE CASCADE,
  order_id                      TEXT NOT NULL,
  overridden_by                 UUID NOT NULL REFERENCES users(id),
  override_reason               TEXT NOT NULL CHECK (length(btrim(override_reason)) > 0),
  customer_balance_at_override  DECIMAL(12,2),
  credit_limit_at_override      DECIMAL(12,2),
  expires_at                    TIMESTAMPTZ,
  is_one_time                   BOOLEAN DEFAULT true,
  consumed_at                   TIMESTAMPTZ,
  company_id                    TEXT,
  location_id                   TEXT,
  created_at                    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cho_customer ON credit_hold_overrides(customer_id);
CREATE INDEX IF NOT EXISTS idx_cho_order    ON credit_hold_overrides(order_id);
CREATE INDEX IF NOT EXISTS idx_cho_active   ON credit_hold_overrides(customer_id, consumed_at, expires_at);

-- ── 1D. RLS ────────────────────────────────────────────────────────────────
-- The service role used by the backend bypasses RLS, but enabling it keeps
-- direct PostgREST access (e.g., portal users) locked down.
ALTER TABLE credit_hold_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_hold_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_hold_log_service_only ON credit_hold_log;
CREATE POLICY credit_hold_log_service_only ON credit_hold_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS credit_hold_overrides_service_only ON credit_hold_overrides;
CREATE POLICY credit_hold_overrides_service_only ON credit_hold_overrides
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
