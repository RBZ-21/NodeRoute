-- Password reset support for the /auth/forgot-password + /auth/reset-password flow.
-- reset_token stores a SHA-256 hash of the emailed token (never the raw value);
-- reset_expires bounds the link's validity window.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token   TEXT,
  ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;

-- Lookup is by hashed token; a partial index keeps it cheap without bloating the
-- common case where no reset is in flight.
CREATE INDEX IF NOT EXISTS idx_users_reset_token
  ON users (reset_token)
  WHERE reset_token IS NOT NULL;
