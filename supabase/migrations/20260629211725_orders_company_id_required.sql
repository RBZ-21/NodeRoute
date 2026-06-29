-- Require a tenant on every new/updated order row.
--
-- Orders without a company_id are invisible to every company's scoped
-- queries (scopeQueryByContext filters on company_id), so they are
-- unreachable orphans. The Bland webhook previously inserted such rows.
--
-- NOT VALID: the constraint is enforced for all NEW inserts and updates
-- immediately, but pre-existing NULL rows do not block the migration.
-- After backfilling legacy rows, validate it:
--
--   -- 1. Inspect orphans:
--   --    SELECT id, created_at, source FROM public.orders WHERE company_id IS NULL;
--   -- 2. Backfill each to its correct tenant (or archive/delete), then:
--   --    ALTER TABLE public.orders VALIDATE CONSTRAINT orders_company_id_not_null;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_company_id_not_null;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_company_id_not_null
  CHECK (company_id IS NOT NULL) NOT VALID;
