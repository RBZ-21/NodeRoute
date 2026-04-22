alter table if exists routes
  add column if not exists active_stop_ids jsonb default '[]'::jsonb;

update routes
set active_stop_ids = to_jsonb(stop_ids)
where active_stop_ids = '[]'::jsonb
  and stop_ids is not null;
