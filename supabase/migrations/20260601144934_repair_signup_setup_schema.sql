-- Repair signup setup schema drift on remotes where products exists but
-- company_config was never applied through the migration history.

CREATE TABLE IF NOT EXISTS public.company_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  business_types text[] NOT NULL DEFAULT '{}',
  enabled_units text[] NOT NULL DEFAULT '{}',
  feat_catch_weight boolean NOT NULL DEFAULT false,
  feat_fsma_lot_tracking boolean NOT NULL DEFAULT false,
  feat_cold_chain_notes boolean NOT NULL DEFAULT false,
  feat_alcohol_compliance boolean NOT NULL DEFAULT false,
  feat_deposit_tracking boolean NOT NULL DEFAULT false,
  feat_case_to_each boolean NOT NULL DEFAULT false,
  catalog_template text NOT NULL DEFAULT 'blank',
  catalog_setup text NOT NULL DEFAULT 'blank',
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_config_company_id_unique UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS company_config_company_id_idx
  ON public.company_config (company_id);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric;

INSERT INTO public.company_config (
  company_id,
  business_types,
  enabled_units,
  feat_catch_weight,
  feat_fsma_lot_tracking,
  feat_cold_chain_notes,
  feat_alcohol_compliance,
  feat_deposit_tracking,
  feat_case_to_each,
  catalog_template,
  catalog_setup,
  onboarding_completed
)
SELECT
  c.id,
  ARRAY[]::text[],
  ARRAY[]::text[],
  false,
  false,
  false,
  false,
  false,
  false,
  'blank',
  'blank',
  false
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.company_config cc
  WHERE cc.company_id = c.id
)
ON CONFLICT (company_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_config TO authenticated;

NOTIFY pgrst, 'reload schema';
