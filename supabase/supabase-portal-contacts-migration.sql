-- Customer portal contacts table
-- Run once in Supabase SQL editor or via migration tooling

CREATE TABLE IF NOT EXISTS portal_contacts (
  email     TEXT PRIMARY KEY,
  name      TEXT,
  phone     TEXT,
  address   TEXT,
  company   TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
