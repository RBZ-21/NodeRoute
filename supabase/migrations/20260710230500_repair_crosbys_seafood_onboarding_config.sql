-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260710230500_repair_crosbys_seafood_onboarding_config
-- Purpose  : Crosby's Seafood Wholesale (company_id 00000000-0000-0000-0000-000000000001,
--            the original test-business fixture renamed to a real customer) was
--            missing a completed onboarding profile. Its company_config row
--            (created 2026-06-01) still had onboarding_completed = false and
--            blank business_types / enabled_units / seafood feature flags,
--            because the company was renamed and staffed directly rather than
--            run through the real /api/auth/signup flow that normally writes
--            these fields.
--
--            Effect in the app: frontend-v2 App.tsx useOnboardingGate calls
--            GET /api/company-config/features and shows the OnboardingWizard
--            instead of the dashboard for any non-driver, non-superadmin user
--            whenever onboarding_completed is not true. Two new admin users
--            added to this company (west@crosbysseafood.com,
--            rweatherford@crosbysseafood.com) were hitting that wizard instead
--            of reaching the dashboard.
--
--            This migration backfills the same values
--            backend/routes/auth.js companyConfigDefaultsFromSignup() would
--            have written for distributorType = 'seafood'. The change was
--            already applied directly against the live database via Supabase
--            MCP on 2026-07-10 to unblock the two users immediately; this
--            file (and a matching supabase apply_migration call) makes that
--            change idempotent and tracked going forward instead of leaving
--            it as an undocumented live-only edit.
-- ─────────────────────────────────────────────────────────────────────────────

update public.company_config
set
  onboarding_completed   = true,
  business_types         = array['seafood']::text[],
  enabled_units           = array['lb','catch_weight','case']::text[],
  feat_catch_weight       = true,
  feat_fsma_lot_tracking  = true,
  feat_cold_chain_notes   = true,
  updated_at              = now()
where company_id = '00000000-0000-0000-0000-000000000001'
  and onboarding_completed is distinct from true;
