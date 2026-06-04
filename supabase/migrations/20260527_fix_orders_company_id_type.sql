-- Fix orders.company_id if it was created as integer instead of uuid.
-- The multi_company migration (20260416) declares it as `uuid`, but if the
-- column already existed in the live database with a different type the ADD
-- COLUMN IF NOT EXISTS was silently skipped, leaving an integer column that
-- causes "column company_id of type integer but expression is of type text"
-- whenever a trigger, RLS policy, or write involving that column fires.

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type
    INTO col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'orders'
     AND column_name  = 'company_id';

  IF col_type IS NOT NULL AND col_type NOT IN ('uuid', 'text', 'character varying') THEN
    -- Drop the wrong-typed column (losing integer values that can't map to UUIDs
    -- anyway) and recreate it as uuid with the default company.
    ALTER TABLE public.orders DROP COLUMN company_id;
    ALTER TABLE public.orders
      ADD COLUMN company_id uuid
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES public.companies(id) ON DELETE CASCADE;
    UPDATE public.orders
       SET company_id = '00000000-0000-0000-0000-000000000001'
     WHERE company_id IS NULL;
  END IF;
END;
$$;
