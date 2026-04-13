-- Migration: create users table
-- Replaces the file-based backend/data/users.json storage

CREATE TABLE IF NOT EXISTS public.users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT,
  role           TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('admin', 'manager', 'driver')),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending')),
  invite_token   TEXT,
  invite_expires TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast email lookups (used on every login)
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON public.users (LOWER(email));

-- Index for invite token lookups
CREATE INDEX IF NOT EXISTS users_invite_token_idx ON public.users (invite_token)
  WHERE invite_token IS NOT NULL;
