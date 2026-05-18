-- Make the order audit trigger resilient to legacy order schemas that do not
-- carry every optional audit field, such as customer_id or total_amount.

CREATE OR REPLACE FUNCTION fn_audit_log_order_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_action TEXT;
  v_meta JSONB := '{}'::JSONB;
  v_old JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
  v_new JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
  v_order_id TEXT;
  v_customer_id BIGINT;
  v_company_id TEXT;
  v_location_id TEXT;
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
      THEN COALESCE(v_new ->> 'customer_id', v_old ->> 'customer_id')::BIGINT
    ELSE NULL
  END;
  v_company_id := COALESCE(v_new ->> 'company_id', v_old ->> 'company_id');
  v_location_id := COALESCE(v_new ->> 'location_id', v_old ->> 'location_id');

  INSERT INTO audit_log (action_type, customer_id, order_id, metadata, company_id, location_id)
  VALUES (v_action, v_customer_id, v_order_id, v_meta, v_company_id, v_location_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;
