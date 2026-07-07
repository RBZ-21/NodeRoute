-- ================================================================
-- Migration: 20260704010000_add_warehouse_role
-- Adds 'warehouse' to the users.role CHECK constraint. This role
-- is already referenced by backend/routes/warehouse.js and
-- backend/routes/warehouse-locations.js (WAREHOUSE_ROLES constant)
-- but was never added to the database, so creating a user with
-- this role has been rejected until now.
-- ================================================================

DO $$
BEGIN
  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_check;

  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS "users_role_check1";
EXCEPTION WHEN others THEN
  NULL; -- ignore if no constraint existed
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'manager', 'driver', 'warehouse'));
