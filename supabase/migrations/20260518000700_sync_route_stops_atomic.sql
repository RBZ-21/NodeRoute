-- Atomic route-stop assignment via a single Postgres function.
-- Replaces the multi-update loop in route-stop-sync.js that could leave
-- stops in a partial state (some assigned, some stuck at negative sequences)
-- when any mid-loop update failed.
--
-- security definer: runs as the function owner so RLS on the stops table
-- does not block the temp-negate step (which touches rows the caller may
-- not own yet).

create or replace function sync_route_stop_assignments(
  p_route_id text,
  p_stop_ids text[],
  p_active_stop_ids text[]
) returns void
language plpgsql
security definer
as $$
begin
  -- Step 1: temp-negate existing sequences to avoid unique index conflicts
  update stops
  set stop_seq = -(row_number() over (order by id))::int
  where route_id = p_route_id and stop_seq is not null;

  -- Step 2: unassign stops no longer in this route
  update stops
  set route_id = null, stop_seq = null
  where route_id = p_route_id
    and id::text <> all(p_stop_ids);

  -- Step 3: assign + sequence active stops in declared order
  update stops
  set route_id = p_route_id,
      stop_seq  = pos.seq
  from (
    select
      unnest(p_active_stop_ids) as id,
      generate_subscripts(p_active_stop_ids, 1) as seq
  ) as pos
  where stops.id::text = pos.id;

  -- Step 4: assign non-active stops (in p_stop_ids but not p_active_stop_ids) with null seq
  update stops
  set route_id = p_route_id,
      stop_seq  = null
  where id::text = any(p_stop_ids)
    and (id::text <> all(p_active_stop_ids) or array_length(p_active_stop_ids, 1) is null);
end;
$$;
