-- Complete catch weight management for food distribution.
-- Supports normalized order_items while preserving the app's current JSON
-- order line workflow through order_id + item_index compatibility columns.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_catch_weight BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catch_weight_unit VARCHAR(20) NOT NULL DEFAULT 'lb'
    CHECK (catch_weight_unit IN ('lb', 'kg', 'oz')),
  ADD COLUMN IF NOT EXISTS estimated_unit_weight DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight_tolerance_pct DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS default_price_per_lb DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS pricing_method VARCHAR(20) NOT NULL DEFAULT 'per_unit'
    CHECK (pricing_method IN ('per_unit', 'per_weight'));

CREATE INDEX IF NOT EXISTS products_catch_weight_idx
  ON public.products(company_id, is_catch_weight)
  WHERE is_catch_weight = true;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS catch_weight_summary JSONB;

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_item_number TEXT,
  item_index INTEGER,
  name TEXT,
  ordered_quantity DECIMAL(10,4) NOT NULL DEFAULT 0,
  ordered_unit VARCHAR(20) NOT NULL DEFAULT 'case',
  unit_price DECIMAL(12,4) NOT NULL DEFAULT 0,
  estimated_weight DECIMAL(10,4),
  price_per_weight_unit DECIMAL(10,4),
  is_catch_weight BOOLEAN NOT NULL DEFAULT false,
  catch_weight_entry_id UUID,
  weight_status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (weight_status IN ('pending', 'weighed', 'variance_flagged', 'approved')),
  approved_by TEXT REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS order_items_company_id_idx ON public.order_items(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS order_items_order_item_index_idx
  ON public.order_items(order_id, item_index)
  WHERE item_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.catch_weight_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID REFERENCES public.order_items(id) ON DELETE CASCADE,
  order_item_ref TEXT,
  -- Compatibility for existing orders.items JSON lines.
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  item_index INTEGER,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  lot_id UUID REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_item_number TEXT,
  ordered_quantity DECIMAL(10,4) NOT NULL,
  ordered_unit VARCHAR(20) NOT NULL,
  actual_weight DECIMAL(10,4),
  weight_unit VARCHAR(10) NOT NULL DEFAULT 'lb',
  price_per_weight_unit DECIMAL(10,4) NOT NULL,
  estimated_weight DECIMAL(10,4),
  weight_status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (weight_status IN ('pending', 'weighed', 'variance_flagged', 'approved')),
  variance_weight DECIMAL(10,4) GENERATED ALWAYS AS
    (actual_weight - estimated_weight) STORED,
  variance_pct DECIMAL(6,3) GENERATED ALWAYS AS
    (CASE WHEN estimated_weight > 0
      THEN ((actual_weight - estimated_weight) / estimated_weight * 100)
      ELSE 0 END) STORED,
  total_price DECIMAL(12,4) GENERATED ALWAYS AS
    (actual_weight * price_per_weight_unit) STORED,
  weighed_by TEXT REFERENCES public.users(id),
  weighed_at TIMESTAMPTZ,
  approved_by TEXT REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  scale_id VARCHAR(100),
  notes TEXT,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catch_weight_entries_order_line_present CHECK (
    order_item_id IS NOT NULL OR order_item_ref IS NOT NULL OR (order_id IS NOT NULL AND item_index IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cw_order_item
  ON public.catch_weight_entries(order_item_id);
CREATE INDEX IF NOT EXISTS idx_cw_order_item_ref
  ON public.catch_weight_entries(order_item_ref);
CREATE INDEX IF NOT EXISTS idx_cw_order
  ON public.catch_weight_entries(order_id, item_index);
CREATE INDEX IF NOT EXISTS idx_cw_product
  ON public.catch_weight_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_cw_invoice
  ON public.catch_weight_entries(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cw_company_created
  ON public.catch_weight_entries(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cw_unapproved_variance
  ON public.catch_weight_entries(company_id, variance_pct DESC)
  WHERE approved_at IS NULL;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_catch_weight BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catch_weight_entry_id UUID,
  ADD COLUMN IF NOT EXISTS weight_status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (weight_status IN ('pending', 'weighed', 'variance_flagged', 'approved')),
  ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_items_catch_weight_entry_fk'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_catch_weight_entry_fk
      FOREIGN KEY (catch_weight_entry_id)
      REFERENCES public.catch_weight_entries(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_catch_weight_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_updated_at ON public.order_items;
CREATE TRIGGER trg_order_items_updated_at
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_catch_weight_updated_at();

DROP TRIGGER IF EXISTS trg_catch_weight_entries_updated_at ON public.catch_weight_entries;
CREATE TRIGGER trg_catch_weight_entries_updated_at
  BEFORE UPDATE ON public.catch_weight_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_catch_weight_updated_at();

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_tenant_isolation ON public.order_items;
CREATE POLICY order_items_tenant_isolation ON public.order_items
  FOR ALL TO authenticated
  USING (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  )
  WITH CHECK (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  );

ALTER TABLE public.catch_weight_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catch_weight_entries_tenant_isolation ON public.catch_weight_entries;
CREATE POLICY catch_weight_entries_tenant_isolation ON public.catch_weight_entries
  FOR ALL TO authenticated
  USING (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  )
  WITH CHECK (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  );
