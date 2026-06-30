-- ============================================================================
-- Premium add-on: Customer Portal Ordering (gated per company)
-- ----------------------------------------------------------------------------
-- portal_ordering_enabled gates the entire online-ordering feature. Default
-- false: the feature is off until a superadmin enables it per company on the
-- Companies page. Every portal-ordering API endpoint checks this flag
-- server-side and returns 403 FEATURE_NOT_ENABLED when off.
--
-- Schema note: companies.id is UUID in this deployment; this only adds a
-- boolean column to the existing companies table (no new FK / type concerns).
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS portal_ordering_enabled BOOLEAN NOT NULL DEFAULT false;
