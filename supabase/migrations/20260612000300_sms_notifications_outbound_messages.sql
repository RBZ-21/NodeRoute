-- ============================================================================
-- Customer delivery SMS: preferences + outbound message log
-- ----------------------------------------------------------------------------
-- 1. Customers.sms_notifications_enabled — per-customer opt-out toggle
--    (default true) editable on the Customers page.
-- 2. outbound_messages — append-style log of every delivery SMS attempt with
--    status, used for (a) auditability and (b) de-duplication so the same
--    event is never sent twice for one stop/order.
--
-- Schema notes:
--   * The Customers table is mixed-case ("Customers") in this deployment.
--   * company_id is TEXT, matching the existing tenant-scoping columns.
--   * order_id / stop_id are TEXT with no FK so the log remains valid across
--     deployments where those PKs may be UUID or BIGINT (same convention as
--     credit_hold_log).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Customer SMS preference ──────────────────────────────────────────────
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT true;

-- ── 2. Outbound message log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbound_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   TEXT,
  order_id     TEXT,
  stop_id      TEXT,
  event        VARCHAR(40) NOT NULL,
  channel      VARCHAR(20) NOT NULL DEFAULT 'sms',
  phone        TEXT,
  body         TEXT,
  status       VARCHAR(20) NOT NULL,
  provider_sid TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'outbound_messages_status_chk'
  ) THEN
    ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_status_chk
      CHECK (status IN ('sent', 'failed', 'skipped', 'dry_run'));
  END IF;
END$$;

-- De-dup safety net: at most one successful send per (event, stop) and per
-- (event, order). The service checks before sending; these indexes guarantee
-- it even under concurrent completions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_event_stop_sent
  ON outbound_messages(event, stop_id)
  WHERE status IN ('sent', 'dry_run') AND stop_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_event_order_sent
  ON outbound_messages(event, order_id)
  WHERE status IN ('sent', 'dry_run') AND order_id IS NOT NULL AND stop_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_phone_recent
  ON outbound_messages(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_company
  ON outbound_messages(company_id, created_at DESC);

-- ── RLS: tenant-scoped, matching the 20260528 security sweep ───────────────
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outbound_messages: tenant scoped" ON outbound_messages;
CREATE POLICY "outbound_messages: tenant scoped"
  ON outbound_messages
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin() OR company_id::text = public.auth_company_id_text())
  WITH CHECK (public.is_platform_admin() OR company_id::text = public.auth_company_id_text());
