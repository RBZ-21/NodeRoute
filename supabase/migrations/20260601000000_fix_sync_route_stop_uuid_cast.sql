-- Fix: uuid = text type mismatch in sync_route_stop_assignments.
-- The stops.route_id column is uuid but p_route_id was declared as text,
-- causing "operator does not exist: uuid = text" on delete (when stops
-- actually have a route_id assigned). Cast p_route_id to uuid in all
-- WHERE clauses that compare against stops.route_id.

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
  update stops s
  set stop_seq = -(sub.rn)::int
  from (
    select id, row_number() over (order by id) as rn
    from stops
    where route_id = p_route_id::uuid and stop_seq is not null
  ) sub
  where s.id = sub.id;

  -- Step 2: unassign stops no longer in this route
  update stops
  set route_id = null, stop_seq = null
  where route_id = p_route_id::uuid
    and id::text <> all(p_stop_ids);

  -- Step 3: assign + sequence active stops in declared order
  update stops
  set route_id = p_route_id::uuid,
      stop_seq  = pos.seq
  from (
    select
      unnest(p_active_stop_ids) as id,
      generate_subscripts(p_active_stop_ids, 1) as seq
  ) as pos
  where stops.id::text = pos.id;

  -- Step 4: assign non-active stops (in p_stop_ids but not p_active_stop_ids) with null seq
  update stops
  set route_id = p_route_id::uuid,
      stop_seq  = null
  where id::text = any(p_stop_ids)
    and (id::text <> all(p_active_stop_ids) or array_length(p_active_stop_ids, 1) is null);
end;
$$;
