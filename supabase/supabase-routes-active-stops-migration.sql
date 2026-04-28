-- Adds per-day active route stop tracking without changing saved route templates.
-- Run this once in the Supabase SQL editor for existing databases.

alter table if exists public.routes
  add column if not exists active_stop_ids uuid[] default '{}';

update public.routes
set active_stop_ids = stop_ids
where active_stop_ids is null
  and stop_ids is not null;

notify pgrst, 'reload schema';
