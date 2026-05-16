-- Migration: create_waitlist
-- Creates the waitlist table for landing page signups.
-- Run this once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  name       text,
  company    text,
  source     text NOT NULL DEFAULT 'landing',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate emails
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_unique ON waitlist (lower(email));

-- RLS: table is insert-only from the public (backend service role bypasses RLS)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- No SELECT/UPDATE/DELETE for anonymous users — only the service role (backend) can read
CREATE POLICY "waitlist_insert_public"
  ON waitlist
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Index for admin queries sorted by signup date
CREATE INDEX IF NOT EXISTS waitlist_created_at_idx ON waitlist (created_at DESC);
