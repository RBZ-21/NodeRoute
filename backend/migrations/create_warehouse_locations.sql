-- Migration: create_warehouse_locations
-- Creates the warehouse_locations table for storing named storage locations
-- (zones, bays, coolers, etc.) within the warehouse.

CREATE TABLE IF NOT EXISTS public.warehouse_locations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  zone          TEXT,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep updated_at current automatically
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouse_locations_updated_at ON public.warehouse_locations;
CREATE TRIGGER trg_warehouse_locations_updated_at
  BEFORE UPDATE ON public.warehouse_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS (Supabase standard)
ALTER TABLE public.warehouse_locations ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (adjust policy to match your auth setup)
DROP POLICY IF EXISTS "authenticated_all" ON public.warehouse_locations;
CREATE POLICY "authenticated_all"
  ON public.warehouse_locations
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
