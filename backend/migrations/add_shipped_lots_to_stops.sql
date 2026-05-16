-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_shipped_lots_to_stops
-- Purpose  : FSMA 204 — freeze a snapshot of which lots were on the truck at
--            dispatch time. Intentional denormalization: the snapshot must not
--            change even if the originating order is later edited or cancelled.
--
-- Each element of shipped_lots is:
--   { "lot_number": "SALMON-2026-001", "product_id": "SAL-01", "quantity": 50 }
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS shipped_lots JSONB;

CREATE INDEX IF NOT EXISTS idx_stops_shipped_lots_gin
  ON stops USING GIN (shipped_lots);
