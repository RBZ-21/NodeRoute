-- ============================================================================
-- AI Insights
-- ----------------------------------------------------------------------------
-- Stores the results of scheduled AI analyses (operational anomaly detection,
-- smart reorder alerts, AI collections risk) so the dashboard can surface them
-- proactively instead of waiting for a manual "Run" click.
--
-- Schema notes:
--   * company_id is TEXT with no FK, matching the existing tenant-scoping
--     columns in this deployment (see credit_hold_log / 20260528 RLS sweep).
--   * One row per (company, type) refresh cycle; the scheduler replaces
--     unacknowledged rows of the same type, so re-runs are idempotent.
-- ============================================================================

-- pgcrypto provides gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ai_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT,
  type            VARCHAR(40) NOT NULL,
  severity        VARCHAR(20) NOT NULL DEFAULT 'info',
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_insights_type_chk'
  ) THEN
    ALTER TABLE ai_insights ADD CONSTRAINT ai_insights_type_chk
      CHECK (type IN ('anomaly', 'reorder', 'collections'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_insights_severity_chk'
  ) THEN
    ALTER TABLE ai_insights ADD CONSTRAINT ai_insights_severity_chk
      CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_ai_insights_company_open
  ON ai_insights(company_id, type) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_insights_created
  ON ai_insights(created_at DESC);

-- ── RLS: same tenant-scoped pattern as the 20260528 security sweep ──────────
-- The backend uses the service role and bypasses RLS; these policies protect
-- direct anon/authenticated Data API access.
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_insights: tenant scoped" ON ai_insights;
CREATE POLICY "ai_insights: tenant scoped"
  ON ai_insights
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin() OR company_id::text = public.auth_company_id_text())
  WITH CHECK (public.is_platform_admin() OR company_id::text = public.auth_company_id_text());
