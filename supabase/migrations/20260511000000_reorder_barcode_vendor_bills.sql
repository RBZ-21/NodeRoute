-- ── Products: reorder thresholds and barcode identifiers ──────────────────────
-- reorder_point: when on_hand_qty drops to or below this value, surface a reorder alert.
-- barcode: optional UPC/EAN barcode for scanner-assisted receiving.
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_point numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;

-- Fast lookup for low-stock dashboard query
CREATE INDEX IF NOT EXISTS products_low_stock_idx
  ON products(company_id, on_hand_qty, reorder_point)
  WHERE reorder_point IS NOT NULL AND reorder_point > 0;

-- One barcode per product per company
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_company_idx
  ON products(company_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

-- ── Vendor bills: auto-generated on full PO receipt ───────────────────────────
-- Created automatically when a vendor purchase order reaches fully-received status.
-- Can also be created manually. Tracks payment lifecycle (pending → approved → paid).
CREATE TABLE IF NOT EXISTS vendor_bills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number       text NOT NULL,
  purchase_order_id uuid,
  vendor            text,
  vendor_id         uuid,
  amount            numeric NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending',  -- pending | approved | paid | void
  due_date          date,
  paid_at           timestamptz,
  paid_by           text,
  notes             text,
  auto_generated    boolean NOT NULL DEFAULT false,
  created_by        text,
  company_id        uuid,
  location_id       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_bills_company_status_idx
  ON vendor_bills(company_id, status);
CREATE INDEX IF NOT EXISTS vendor_bills_po_idx
  ON vendor_bills(purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

ALTER TABLE vendor_bills ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vendor_bills' AND policyname = 'vendor_bills_admin_manager'
  ) THEN
    CREATE POLICY "vendor_bills_admin_manager" ON vendor_bills
      FOR ALL
      USING ((SELECT is_admin_or_manager()))
      WITH CHECK ((SELECT is_admin_or_manager()));
  END IF;
END $$;
