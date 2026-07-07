-- -----------------------------------------------------------------------------
-- Migration: 20260706212500_db013_order_audit_total_column
-- Finding  : DB-013 (Root Depth Scan, commit 904d7119)
-- Purpose  : Reissue the order audit trigger so order-created/deleted metadata
--            reads the canonical orders.total field instead of preferring the
--            legacy total_amount name.
--
--            This definition is based on
--            20260604201715_fix_audit_log_scope_types.sql so the UUID-safe text
--            scope fields and guarded integer customer_id parsing are preserved.
--            It also keeps the later function search_path hardening inline.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_audit_log_order_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
  v_meta jsonb := '{}'::jsonb;
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_order_id text;
  v_customer_id integer;
  v_company_id text;
  v_location_id text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'order_created';
    v_meta := jsonb_build_object(
      'status', v_new ->> 'status',
      'total', v_new ->> 'total'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'order_updated';
    v_meta := jsonb_build_object(
      'changed_fields', (
        SELECT jsonb_object_agg(key, jsonb_build_object('from', old_val, 'to', new_val))
        FROM (
          SELECT key,
                 v_old -> key AS old_val,
                 v_new -> key AS new_val
          FROM jsonb_object_keys(v_new) AS key
          WHERE v_old -> key IS DISTINCT FROM v_new -> key
        ) diffs
      )
    );

    IF v_old ->> 'status' IS DISTINCT FROM v_new ->> 'status' THEN
      v_action := 'order_status_changed';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'order_deleted';
    v_meta := jsonb_build_object(
      'status', v_old ->> 'status',
      'total', v_old ->> 'total'
    );
  END IF;

  v_order_id := COALESCE(v_new ->> 'id', v_old ->> 'id');
  v_customer_id := CASE
    WHEN COALESCE(v_new ->> 'customer_id', v_old ->> 'customer_id', '') ~ '^[0-9]+$'
      THEN COALESCE(v_new ->> 'customer_id', v_old ->> 'customer_id')::integer
    ELSE NULL
  END;
  v_company_id := COALESCE(v_new ->> 'company_id', v_old ->> 'company_id');
  v_location_id := COALESCE(v_new ->> 'location_id', v_old ->> 'location_id');

  INSERT INTO public.audit_log (action_type, customer_id, order_id, metadata, company_id, location_id)
  VALUES (v_action, v_customer_id, v_order_id, v_meta, v_company_id, v_location_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;
