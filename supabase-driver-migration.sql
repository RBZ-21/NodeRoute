-- Driver interface migrations
-- Run in Supabase SQL Editor

-- 1. Add door_code to stops table (visible to drivers on their route)
ALTER TABLE stops ADD COLUMN IF NOT EXISTS door_code TEXT;

-- 2. Add door_code to portal_contacts table (set by customers)
ALTER TABLE portal_contacts ADD COLUMN IF NOT EXISTS door_code TEXT;
