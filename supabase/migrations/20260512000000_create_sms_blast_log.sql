-- Idempotency log for scheduled SMS blasts.
-- One row per (blast_type, blast_date, company_id) prevents double-fire on restart.
CREATE TABLE IF NOT EXISTS sms_blast_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_type text        NOT NULL,
  blast_date date        NOT NULL,
  company_id text        NOT NULL DEFAULT '',
  sent_count integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blast_type, blast_date, company_id)
);

ALTER TABLE sms_blast_log ENABLE ROW LEVEL SECURITY;

-- Only the service role (backend) can read/write blast logs.
CREATE POLICY sms_blast_log_service_only ON sms_blast_log
  FOR ALL
  USING (false);
