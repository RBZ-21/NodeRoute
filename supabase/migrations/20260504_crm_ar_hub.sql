-- Migration: CRM Sales Rep Hub + AR Finance Hub
-- Created: 2026-05-04

-- 1. Add sales_rep_id to Customers
ALTER TABLE "Customers"
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_sales_rep_id ON "Customers"(sales_rep_id);

-- 2. Customer visit logs
CREATE TABLE IF NOT EXISTS customer_visit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     TEXT NOT NULL,
  customer_name   TEXT,
  sales_rep_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  sales_rep_name  TEXT,
  notes           TEXT,
  outcome         TEXT,
  visited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_id      UUID,
  location_id     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visit_logs_rep      ON customer_visit_logs(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_visit_logs_customer ON customer_visit_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_visit_logs_visited  ON customer_visit_logs(visited_at DESC);

-- 3. Collections columns on invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS collections_note   TEXT,
  ADD COLUMN IF NOT EXISTS collections_status TEXT DEFAULT 'open'
    CHECK (collections_status IN ('open','contacted','promise_to_pay','escalated','resolved'));

-- 4. RLS for visit logs (service role has full access)
ALTER TABLE customer_visit_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'customer_visit_logs' AND policyname = 'service role full access'
  ) THEN
    CREATE POLICY "service role full access" ON customer_visit_logs
      USING (true) WITH CHECK (true);
  END IF;
END $$;
