-- Automated reorder suggestions for NodeRoute.
-- Adds learning inputs, auditable suggestions, and PO linkage.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reorder_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reorder_point DECIMAL(10,4) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reorder_quantity DECIMAL(10,4) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS safety_stock DECIMAL(10,4) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS lead_time_days INTEGER DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS min_order_quantity DECIMAL(10,4) DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS max_stock_level DECIMAL(10,4) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS avg_daily_usage DECIMAL(10,4) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS usage_trend VARCHAR(20) DEFAULT 'stable';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS last_reorder_calc_at TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS preferred_vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_reorder_enabled
  ON public.products(company_id, reorder_enabled, on_hand_qty, reorder_point)
  WHERE reorder_enabled = true;

CREATE TABLE IF NOT EXISTS public.reorder_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  suggested_quantity DECIMAL(10,4) NOT NULL,
  suggested_unit VARCHAR(20) NOT NULL,
  current_stock DECIMAL(10,4) NOT NULL,
  reorder_point DECIMAL(10,4) NOT NULL,
  safety_stock DECIMAL(10,4) NOT NULL,
  avg_daily_usage DECIMAL(10,4) NOT NULL,
  lead_time_days INTEGER NOT NULL,
  days_of_stock_remaining DECIMAL(8,2),
  urgency VARCHAR(20) NOT NULL DEFAULT 'normal',
  reason TEXT NOT NULL,
  upcoming_order_demand DECIMAL(10,4) DEFAULT 0,
  seasonal_adjustment_pct DECIMAL(6,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  snoozed_until TIMESTAMPTZ,
  approved_by TEXT REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  dismissed_by TEXT REFERENCES public.users(id),
  dismissed_at TIMESTAMPTZ,
  dismiss_reason TEXT,
  ai_confidence_score DECIMAL(4,3),
  calculation_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT reorder_suggestions_status_check CHECK (
    status IN ('pending', 'approved', 'converted_to_po', 'dismissed', 'snoozed')
  ),
  CONSTRAINT reorder_suggestions_urgency_check CHECK (
    urgency IN ('critical', 'urgent', 'normal', 'scheduled')
  )
);

CREATE INDEX IF NOT EXISTS idx_rs_product ON public.reorder_suggestions(product_id);
CREATE INDEX IF NOT EXISTS idx_rs_status ON public.reorder_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_rs_urgency ON public.reorder_suggestions(urgency);
CREATE INDEX IF NOT EXISTS idx_rs_vendor ON public.reorder_suggestions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rs_company_pending
  ON public.reorder_suggestions(company_id, status, urgency, created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_usage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  recorded_date DATE NOT NULL,
  units_used DECIMAL(10,4) NOT NULL,
  weight_used DECIMAL(10,4),
  order_count INTEGER DEFAULT 0,
  week_of_year INTEGER,
  month_of_year INTEGER,
  is_holiday_week BOOLEAN DEFAULT false,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_puh_product_date
  ON public.product_usage_history(product_id, recorded_date DESC);
CREATE INDEX IF NOT EXISTS idx_puh_company_date
  ON public.product_usage_history(company_id, recorded_date DESC);

CREATE TABLE IF NOT EXISTS public.reorder_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  changed_by TEXT REFERENCES public.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reorder_settings_audit_product
  ON public.reorder_settings_audit(product_id, changed_at DESC);

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS suggestion_id UUID REFERENCES public.reorder_suggestions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_suggestion_id
  ON public.purchase_orders(suggestion_id);

CREATE OR REPLACE FUNCTION public.set_reorder_suggestions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reorder_suggestions_updated_at ON public.reorder_suggestions;
CREATE TRIGGER trg_reorder_suggestions_updated_at
  BEFORE UPDATE ON public.reorder_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_reorder_suggestions_updated_at();

ALTER TABLE public.reorder_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reorder_suggestions_tenant_isolation ON public.reorder_suggestions;
CREATE POLICY reorder_suggestions_tenant_isolation ON public.reorder_suggestions
  FOR ALL TO authenticated
  USING (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  )
  WITH CHECK (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  );

ALTER TABLE public.product_usage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_usage_history_tenant_isolation ON public.product_usage_history;
CREATE POLICY product_usage_history_tenant_isolation ON public.product_usage_history
  FOR ALL TO authenticated
  USING (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  )
  WITH CHECK (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  );

ALTER TABLE public.reorder_settings_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reorder_settings_audit_tenant_isolation ON public.reorder_settings_audit;
CREATE POLICY reorder_settings_audit_tenant_isolation ON public.reorder_settings_audit
  FOR ALL TO authenticated
  USING (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  )
  WITH CHECK (
    company_id = public.auth_company_id()
    OR (SELECT role FROM public.users WHERE id = auth.uid()::text) = 'superadmin'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reorder_suggestions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_usage_history TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reorder_settings_audit TO authenticated, service_role;
