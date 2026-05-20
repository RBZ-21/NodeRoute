CREATE TABLE IF NOT EXISTS public.inventory_location_assignments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_number      TEXT        NOT NULL REFERENCES products(item_number) ON DELETE CASCADE,
  location_id      UUID        NOT NULL REFERENCES warehouse_locations(id) ON DELETE CASCADE,
  qty_at_location  NUMERIC     NOT NULL DEFAULT 0,
  notes            TEXT,
  assigned_by      TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_number, location_id)
);

CREATE INDEX IF NOT EXISTS idx_ila_item_number  ON inventory_location_assignments(item_number);
CREATE INDEX IF NOT EXISTS idx_ila_location_id  ON inventory_location_assignments(location_id);

ALTER TABLE inventory_location_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON inventory_location_assignments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_ila_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ila_updated_at ON inventory_location_assignments;
CREATE TRIGGER trg_ila_updated_at
  BEFORE UPDATE ON inventory_location_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_ila_updated_at();
