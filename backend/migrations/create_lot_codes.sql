-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: create_lot_codes
-- Purpose  : FSMA Section 204 lot-level traceability for FDA Food Traceability
--            List (FTL) products. Captures receiving records at the lot level
--            so the full supply chain can be reconstructed within 24 hours.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lot_codes (
  id                SERIAL          PRIMARY KEY,
  lot_number        TEXT            NOT NULL UNIQUE,
  product_id        TEXT            REFERENCES seafood_inventory(item_number) ON DELETE SET NULL,
  vendor_id         TEXT,           -- vendor name/identifier (free text, matches purchase_orders.vendor)
  quantity_received NUMERIC(10,3)   NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_of_measure   TEXT            NOT NULL DEFAULT 'lb',
  received_date     DATE            NOT NULL DEFAULT CURRENT_DATE,
  received_by       TEXT,           -- user name/email who received it
  expiration_date   DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- lot_number is stored exactly as entered (vendor lot numbering must not be normalized)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lot_codes_lot_number
  ON lot_codes (lot_number);

-- Supports "show all lots for this product" queries (receiving, FEFO ordering)
CREATE INDEX IF NOT EXISTS idx_lot_codes_product
  ON lot_codes (product_id, expiration_date ASC NULLS LAST);

-- Supports date-range reporting
CREATE INDEX IF NOT EXISTS idx_lot_codes_received_date
  ON lot_codes (received_date DESC);
