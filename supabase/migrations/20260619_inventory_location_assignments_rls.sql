-- Scope inventory_location_assignments to tenant (audit H4 remainder).

ALTER TABLE public.inventory_location_assignments
  ADD COLUMN IF NOT EXISTS company_id UUID;

UPDATE public.inventory_location_assignments ila
SET company_id = wl.company_id
FROM public.warehouse_locations wl
WHERE ila.location_id = wl.id
  AND ila.company_id IS NULL
  AND wl.company_id IS NOT NULL;

UPDATE public.inventory_location_assignments ila
SET company_id = p.company_id
FROM public.products p
WHERE ila.item_number = p.item_number
  AND ila.company_id IS NULL
  AND p.company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ila_company_id
  ON public.inventory_location_assignments(company_id);

DROP POLICY IF EXISTS "authenticated_all" ON public.inventory_location_assignments;

CREATE POLICY "ila: tenant scoped admin/manager"
  ON public.inventory_location_assignments
  FOR ALL
  TO authenticated
  USING (is_admin_or_manager() AND company_id = auth_company_id())
  WITH CHECK (is_admin_or_manager() AND company_id = auth_company_id());
