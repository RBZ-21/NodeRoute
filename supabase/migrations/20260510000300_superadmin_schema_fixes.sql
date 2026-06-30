-- ================================================================
-- Migration: 20260510_superadmin_schema_fixes
-- Fixes two schema gaps exposed by the superadmin system audit:
--   1. users.role CHECK constraint didn't include 'superadmin'
--   2. companies table had no 'status' column
-- ================================================================

-- 1. Widen the role CHECK constraint to accept 'superadmin'.
--    PostgreSQL requires dropping and re-adding a named constraint,
--    or using ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT.
--    We use DO block to handle both named and unnamed constraint cases.

DO $$
BEGIN
  -- Drop the existing role check constraint (name may vary across envs)
  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_check;

  -- Also try the pg-default unnamed constraint name pattern
  -- (Postgres names it <table>_<col>_check when no name given)
  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS "users_role_check1";
EXCEPTION WHEN others THEN
  NULL; -- ignore if no constraint existed
END $$;

-- Re-add with superadmin included
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'manager', 'driver'));

-- 2. Add status column to companies.
--    Values: active | suspended | trial
--    Existing rows default to 'active'.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'trial'));

-- Index for fast status-filtered queries in the superadmin dashboard.
CREATE INDEX IF NOT EXISTS idx_companies_status ON public.companies (status);

-- 3. Backfill any existing companies that somehow have a NULL status
--    (shouldn't occur with DEFAULT, but defensive).
UPDATE public.companies SET status = 'active' WHERE status IS NULL;
