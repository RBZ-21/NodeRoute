-- Enable RLS on portal payment tables
ALTER TABLE portal_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_payment_events ENABLE ROW LEVEL SECURITY;

-- Revoke direct access from anon and authenticated roles
REVOKE ALL ON portal_payment_methods FROM anon, authenticated;
REVOKE ALL ON portal_payment_settings FROM anon, authenticated;
REVOKE ALL ON portal_payment_events FROM anon, authenticated;

-- Grant access only to service_role
-- If direct client access is required, replace with strict tenant/email row-level policies instead
GRANT ALL ON portal_payment_methods TO service_role;
GRANT ALL ON portal_payment_settings TO service_role;
GRANT ALL ON portal_payment_events TO service_role;
