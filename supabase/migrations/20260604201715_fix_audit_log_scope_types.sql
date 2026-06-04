-- Fix legacy audit-log scope columns that still used integer tenant/location
-- IDs after the app moved tenant scope to UUID values. Order/customer triggers
-- write UUID company_id/location_id values, so audit_log must store them as
-- text to preserve both old numeric values and current UUID values.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'company_id'
      AND udt_name <> 'text'
  ) THEN
    ALTER TABLE public.audit_log
      ALTER COLUMN company_id TYPE text USING company_id::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'location_id'
      AND udt_name <> 'text'
  ) THEN
    ALTER TABLE public.audit_log
      ALTER COLUMN location_id TYPE text USING location_id::text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_audit_log_customer_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_action text;
  v_meta jsonb := '{}'::jsonb;
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_customer_id integer;
  v_company_id text;
  v_location_id text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'customer_created';
    v_meta := jsonb_build_object('new', v_new);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'customer_updated';
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

    IF v_old ->> 'credit_hold' IS DISTINCT FROM v_new ->> 'credit_hold' THEN
      v_action := CASE WHEN (v_new ->> 'credit_hold')::boolean THEN 'credit_hold_placed' ELSE 'credit_hold_released' END;
    ELSIF v_old ->> 'credit_limit' IS DISTINCT FROM v_new ->> 'credit_limit' THEN
      v_action := 'credit_limit_changed';
    ELSIF v_old ->> 'credit_terms' IS DISTINCT FROM v_new ->> 'credit_terms' THEN
      v_action := 'credit_terms_changed';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'customer_deleted';
    v_meta := jsonb_build_object('deleted', v_old);
  END IF;

  v_customer_id := CASE
    WHEN COALESCE(v_new ->> 'id', v_old ->> 'id', '') ~ '^[0-9]+$'
      THEN COALESCE(v_new ->> 'id', v_old ->> 'id')::integer
    ELSE NULL
  END;
  v_company_id := COALESCE(v_new ->> 'company_id', v_old ->> 'company_id');
  v_location_id := COALESCE(v_new ->> 'location_id', v_old ->> 'location_id');

  INSERT INTO public.audit_log (action_type, customer_id, metadata, company_id, location_id)
  VALUES (v_action, v_customer_id, v_meta, v_company_id, v_location_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_audit_log_order_change()
RETURNS trigger
LANGUAGE plpgsql
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
      'total', COALESCE(v_new ->> 'total_amount', v_new ->> 'total')
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
      'total', COALESCE(v_old ->> 'total_amount', v_old ->> 'total')
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
