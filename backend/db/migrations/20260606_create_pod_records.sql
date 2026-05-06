-- Create table for Proof of Delivery records
CREATE TABLE IF NOT EXISTS pod_records (
  id SERIAL PRIMARY KEY,
  order_id TEXT NULL,
  stop_id TEXT NULL,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
