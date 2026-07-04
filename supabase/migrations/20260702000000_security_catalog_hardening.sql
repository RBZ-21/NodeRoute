-- Security catalog hardening follow-up from the July 2026 audit.
-- Pin mutable search_path on helper/trigger functions flagged by Supabase's
-- security advisor, and keep the only SECURITY DEFINER RPC service-role only.

ALTER FUNCTION IF EXISTS public.fn_audit_log_customer_change()
  SET search_path = public, pg_temp;

ALTER FUNCTION IF EXISTS public.fn_audit_log_order_change()
  SET search_path = public, pg_temp;

ALTER FUNCTION IF EXISTS public.seafood_inventory_insert_fn()
  SET search_path = public, pg_temp;

ALTER FUNCTION IF EXISTS public.set_reorder_suggestions_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION IF EXISTS public.sync_products_inventory_report_fields()
  SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.sync_route_stop_assignments(
  p_route_id text,
  p_stop_ids text[],
  p_active_stop_ids text[]
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_route_id uuid := p_route_id::uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'sync_route_stop_assignments requires service_role'
      using errcode = '42501';
  end if;

  update public.stops s
  set stop_seq = -(sub.rn)::int
  from (
    select id, row_number() over (order by id) as rn
    from public.stops
    where route_id = v_route_id and stop_seq is not null
  ) sub
  where s.id = sub.id;

  update public.stops
  set route_id = null, stop_seq = null
  where route_id = v_route_id
    and id::text <> all(p_stop_ids);

  update public.stops
  set route_id = v_route_id,
      stop_seq  = pos.seq
  from (
    select
      unnest(p_active_stop_ids) as id,
      generate_subscripts(p_active_stop_ids, 1) as seq
  ) as pos
  where stops.id::text = pos.id;

  update public.stops
  set route_id = v_route_id,
      stop_seq  = null
  where id::text = any(p_stop_ids)
    and (id::text <> all(p_active_stop_ids) or array_length(p_active_stop_ids, 1) is null);
end;
$$;

REVOKE ALL ON FUNCTION public.sync_route_stop_assignments(text, text[], text[]) FROM public;
REVOKE ALL ON FUNCTION public.sync_route_stop_assignments(text, text[], text[]) FROM anon;
REVOKE ALL ON FUNCTION public.sync_route_stop_assignments(text, text[], text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_route_stop_assignments(text, text[], text[]) TO service_role;
