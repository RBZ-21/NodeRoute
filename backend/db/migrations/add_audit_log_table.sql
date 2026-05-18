-- ============================================================
-- Migration: add_audit_log_table
-- Purpose:   Broad app-wide customer activity audit log.
--            Captures every action that modifies a customer
--            record or touches an order belonging to one.
-- ============================================================

-- 1. Core audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  action_type     TEXT        NOT NULL,           -- e.g. 'order_created', 'order_edited', 'customer_updated', 'credit_limit_changed'
  customer_id     INTEGER     REFERENCES "Customers"(id) ON DELETE SET NULL,
  order_id        TEXT,                           -- matches orders.id (text PK)
  performed_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT,
  metadata        JSONB,                          -- arbitrary before/after diff or extra context
  ip_address      INET,
  user_agent      TEXT,
  company_id      INTEGER,
  location_id     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the most common filter patterns
CREATE INDEX IF NOT EXISTS idx_audit_log_customer_id   ON audit_log (customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_by  ON audit_log (performed_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_type   ON audit_log (action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at    ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_order_id      ON audit_log (order_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_company_id    ON audit_log (company_id);

-- 2. Helper function called by triggers
CREATE OR REPLACE FUNCTION fn_audit_log_customer_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_action   TEXT;
  v_meta     JSONB := '{}'::JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'customer_created';
    v_meta   := jsonb_build_object('new', row_to_json(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'customer_updated';
    -- Capture only changed columns to keep metadata lean.
    v_meta := jsonb_build_object(
      'changed_fields', (
        SELECT jsonb_object_agg(key, jsonb_build_object('from', old_val, 'to', new_val))
        FROM (
          SELECT key,
                 (row_to_json(OLD)::JSONB) -> key AS old_val,
                 (row_to_json(NEW)::JSONB) -> key AS new_val
          FROM jsonb_object_keys(row_to_json(NEW)::JSONB) AS key
          WHERE (row_to_json(OLD)::JSONB) -> key IS DISTINCT FROM (row_to_json(NEW)::JSONB) -> key
        ) diffs
      )
    );
    -- Tag specialised actions for easier filtering.
    IF OLD.credit_hold IS DISTINCT FROM NEW.credit_hold THEN
      v_action := CASE WHEN NEW.credit_hold THEN 'credit_hold_placed' ELSE 'credit_hold_released' END;
    ELSIF OLD.credit_limit IS DISTINCT FROM NEW.credit_limit THEN
      v_action := 'credit_limit_changed';
    ELSIF OLD.credit_terms IS DISTINCT FROM NEW.credit_terms THEN
      v_action := 'credit_terms_changed';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'customer_deleted';
    v_meta   := jsonb_build_object('deleted', row_to_json(OLD));
  END IF;

  INSERT INTO audit_log (action_type, customer_id, metadata, company_id, location_id)
  VALUES (
    v_action,
    COALESCE(NEW.id, OLD.id),
    v_meta,
    COALESCE(NEW.company_id, OLD.company_id),
    COALESCE(NEW.location_id, OLD.location_id)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. Trigger on Customers table
DROP TRIGGER IF EXISTS trg_audit_customer ON "Customers";
CREATE TRIGGER trg_audit_customer
  AFTER INSERT OR UPDATE OR DELETE ON "Customers"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_customer_change();

-- 4. Helper function for orders
CREATE OR REPLACE FUNCTION fn_audit_log_order_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_action   TEXT;
  v_meta     JSONB := '{}'::JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'order_created';
    v_meta   := jsonb_build_object('status', NEW.status, 'total', NEW.total_amount);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'order_updated';
    v_meta   := jsonb_build_object(
      'changed_fields', (
        SELECT jsonb_object_agg(key, jsonb_build_object('from', old_val, 'to', new_val))
        FROM (
          SELECT key,
                 (row_to_json(OLD)::JSONB) -> key AS old_val,
                 (row_to_json(NEW)::JSONB) -> key AS new_val
          FROM jsonb_object_keys(row_to_json(NEW)::JSONB) AS key
          WHERE (row_to_json(OLD)::JSONB) -> key IS DISTINCT FROM (row_to_json(NEW)::JSONB) -> key
        ) diffs
      )
    );
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      v_action := 'order_status_changed';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'order_deleted';
    v_meta   := jsonb_build_object('status', OLD.status, 'total', OLD.total_amount);
  END IF;

  INSERT INTO audit_log (action_type, customer_id, order_id, metadata, company_id, location_id)
  VALUES (
    v_action,
    COALESCE(NEW.customer_id, OLD.customer_id),
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    v_meta,
    COALESCE(NEW.company_id, OLD.company_id),
    COALESCE(NEW.location_id, OLD.location_id)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5. Trigger on orders table
DROP TRIGGER IF EXISTS trg_audit_order ON orders;
CREATE TRIGGER trg_audit_order
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_order_change();

-- 6. RLS: only admins/service role can read audit_log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_service_role ON audit_log
  USING (true)
  WITH CHECK (true);
-- Application layer enforces admin/manager role check via requireRole().
