-- Driver interface migrations
-- Run in Supabase SQL Editor

-- 1. Stops table (used by route builder and driver interface)
CREATE TABLE IF NOT EXISTS stops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  lat        NUMERIC DEFAULT 0,
  lng        NUMERIC DEFAULT 0,
  notes      TEXT DEFAULT '',
  door_code  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Routes table (ordered list of stop UUIDs assigned to a driver)
CREATE TABLE IF NOT EXISTS routes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  stop_ids   UUID[] DEFAULT '{}',
  driver     TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add door_code to portal_contacts (set by customers via the portal)
ALTER TABLE portal_contacts ADD COLUMN IF NOT EXISTS door_code TEXT;
