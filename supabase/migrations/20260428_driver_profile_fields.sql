-- Add driver profile fields to users table so deliveries dashboard
-- can show real phone and vehicle info instead of hardcoded placeholders.
alter table public.users
  add column if not exists phone      text,
  add column if not exists vehicle_id text;
