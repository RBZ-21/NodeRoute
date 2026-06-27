-- ============================================================================
-- Portal payment tables + RLS hardening
-- ----------------------------------------------------------------------------
-- Self-contained migration for hosted Supabase deploys: creates the portal
-- payment schema if missing, then enables RLS and restricts direct client
-- access. Backend uses service_role and bypasses RLS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.portal_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email TEXT NOT NULL,
  company_id UUID NULL,
  location_id UUID NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  method_type TEXT NOT NULL CHECK (method_type IN ('debit_card', 'ach_bank')),
  label TEXT NULL,
  payment_method_ref TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  brand TEXT NULL,
  last4 TEXT NULL,
  exp_month INT NULL,
  exp_year INT NULL,
  bank_name TEXT NULL,
  account_last4 TEXT NULL,
  routing_last4 TEXT NULL,
  account_type TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_payment_methods_email
  ON public.portal_payment_methods (customer_email);
CREATE INDEX IF NOT EXISTS idx_portal_payment_methods_scope
  ON public.portal_payment_methods (company_id, location_id);

CREATE TABLE IF NOT EXISTS public.portal_payment_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email TEXT NOT NULL,
  company_id UUID NULL,
  location_id UUID NULL,
  autopay_enabled BOOLEAN NOT NULL DEFAULT false,
  method_id UUID NULL REFERENCES public.portal_payment_methods(id) ON DELETE SET NULL,
  autopay_day_of_month INT NOT NULL DEFAULT 1,
  max_amount NUMERIC(12,2) NULL,
  last_run_at TIMESTAMPTZ NULL,
  next_run_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_payment_settings_email_scope
  ON public.portal_payment_settings (customer_email, company_id, location_id);

CREATE TABLE IF NOT EXISTS public.portal_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email TEXT NOT NULL,
  company_id UUID NULL,
  location_id UUID NULL,
  event_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  method_id UUID NULL REFERENCES public.portal_payment_methods(id) ON DELETE SET NULL,
  method_type TEXT NULL,
  provider TEXT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_payment_events_email
  ON public.portal_payment_events (customer_email, created_at DESC);

-- Enable RLS on portal payment tables
ALTER TABLE public.portal_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_payment_events ENABLE ROW LEVEL SECURITY;

-- Revoke direct access from anon and authenticated roles
REVOKE ALL ON public.portal_payment_methods FROM anon, authenticated;
REVOKE ALL ON public.portal_payment_settings FROM anon, authenticated;
REVOKE ALL ON public.portal_payment_events FROM anon, authenticated;

-- Grant access only to service_role
-- If direct client access is required, replace with strict tenant/email row-level policies instead
GRANT ALL ON public.portal_payment_methods TO service_role;
GRANT ALL ON public.portal_payment_settings TO service_role;
GRANT ALL ON public.portal_payment_events TO service_role;
