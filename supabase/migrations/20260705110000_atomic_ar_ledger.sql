-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260705110000_atomic_ar_ledger
-- Finding  : BE-004 (Root Depth Scan, commit 904d7119) — same non-atomic
--            read-modify-write pattern as BE-001, applied to the AR ledger.
-- Purpose  : backend/services/ar-ledger.js computed customer balance_after and
--            invoice open_balance in JS from previously-read rows, then wrote
--            absolute values back with no lock/transaction. Concurrent posts
--            or receipt applications could lose updates and desync
--            ar_ledger_entries.balance_after from "Customers".current_balance.
--
--            insert_ar_ledger_entry: locks the customer row, performs the
--            idempotency check, computes the balance from ar_ledger_entries,
--            inserts the entry, and updates "Customers".current_balance — all
--            in one transaction.
--
--            apply_invoice_balance_delta: locks the invoice row and applies a
--            delta (or absolute set) to open_balance DB-side, with paid-status
--            side effects. invoices is a legacy table whose payment columns
--            are not all migration-managed, so optional columns are only set
--            when they exist (mirrors executeWithOptionalScope's tolerance).
--
-- Pattern follows 20260705100000_atomic_inventory_ledger (BE-001).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function insert_ar_ledger_entry(
  p_customer_id    text,
  p_entry_type     text,
  p_reference_id   text     default null,
  p_reference_type text     default null,
  p_amount         numeric  default 0,
  p_entry_date     date     default null,
  p_company_id     uuid     default null,
  p_location_id    uuid     default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing      ar_ledger_entries%rowtype;
  v_customer_id   bigint;
  v_signed        numeric;
  v_prev_balance  numeric;
  v_balance_after numeric;
  v_entry         ar_ledger_entries%rowtype;
begin
  if p_customer_id is null or trim(p_customer_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'AR_INVALID_CUSTOMER');
  end if;

  -- Idempotency check inside the transaction (was check-then-insert in JS).
  if p_reference_id is not null then
    select * into v_existing
    from ar_ledger_entries
    where entry_type = p_entry_type
      and reference_id = p_reference_id
      and (p_reference_type is null or reference_type = p_reference_type)
      and (p_company_id  is null or company_id  = p_company_id)
      and (p_location_id is null or location_id = p_location_id)
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'idempotent', true, 'entry', to_jsonb(v_existing));
    end if;
  end if;

  -- Row-level lock on the customer serializes concurrent balance updates.
  -- "Customers".id is BIGINT while AR customer_id is text, hence the cast.
  select id into v_customer_id
  from "Customers"
  where id::text = p_customer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'AR_CUSTOMER_NOT_FOUND', 'customer_id', p_customer_id);
  end if;

  -- Mirror signedLedgerAmount(): payments and credit memos are negative.
  if p_entry_type in ('payment', 'credit_memo') then
    v_signed := -abs(round(coalesce(p_amount, 0), 4));
  else
    v_signed := round(coalesce(p_amount, 0), 4);
  end if;

  select round(coalesce(sum(amount), 0), 2) into v_prev_balance
  from ar_ledger_entries
  where customer_id = p_customer_id
    and (p_company_id  is null or company_id  = p_company_id)
    and (p_location_id is null or location_id = p_location_id);

  v_balance_after := round(v_prev_balance + v_signed, 2);

  insert into ar_ledger_entries (
    customer_id, entry_type, reference_id, reference_type,
    amount, balance_after, entry_date, company_id, location_id
  ) values (
    p_customer_id, p_entry_type, p_reference_id, p_reference_type,
    v_signed, v_balance_after, coalesce(p_entry_date, current_date),
    p_company_id, p_location_id
  ) returning * into v_entry;

  -- Same transaction as the entry insert: balance can no longer desync.
  update "Customers"
  set current_balance = v_balance_after
  where id = v_customer_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'entry', to_jsonb(v_entry),
    'balance_after', v_balance_after
  );
end;
$$;

create or replace function apply_invoice_balance_delta(
  p_invoice_id   text,
  p_delta        numeric default null,
  p_set_absolute numeric default null,
  p_company_id   uuid    default null,
  p_location_id  uuid    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       jsonb;
  v_current   numeric;
  v_next      numeric;
  v_set_parts text[];
  v_updated   jsonb;
begin
  -- invoices is legacy; if open_balance is not a real column this function
  -- cannot help — signal the caller to use its existing path.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'open_balance'
  ) then
    return jsonb_build_object('ok', false, 'code', 'AR_UNSUPPORTED_SCHEMA');
  end if;

  -- Row-level lock: serializes concurrent receipt applications on an invoice.
  select to_jsonb(i.*) into v_row
  from invoices i
  where i.id::text = p_invoice_id
    and (p_company_id  is null or i.company_id  = p_company_id)
    and (p_location_id is null or i.location_id = p_location_id)
  for update;

  if v_row is null then
    return jsonb_build_object('ok', false, 'code', 'AR_INVOICE_NOT_FOUND', 'invoice_id', p_invoice_id);
  end if;

  -- Mirror invoiceAmount(): open_balance ?? balance_due ?? balance ?? total ?? amount.
  v_current := coalesce(
    nullif(v_row ->> 'open_balance', '')::numeric,
    nullif(v_row ->> 'balance_due', '')::numeric,
    nullif(v_row ->> 'balance', '')::numeric,
    nullif(v_row ->> 'total', '')::numeric,
    nullif(v_row ->> 'amount', '')::numeric,
    0
  );

  v_next := round(greatest(0, coalesce(p_set_absolute, v_current - coalesce(p_delta, 0))), 2);

  v_set_parts := array[format('open_balance = %L::numeric', v_next)];
  if v_next <= 0 then
    -- Only set paid-status columns that actually exist on this legacy table.
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'status') then
      v_set_parts := v_set_parts || format('status = %L', 'paid');
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'payment_status') then
      v_set_parts := v_set_parts || format('payment_status = %L', 'paid');
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'paid_at') then
      v_set_parts := v_set_parts || 'paid_at = now()';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'paid_date') then
      v_set_parts := v_set_parts || 'paid_date = now()';
    end if;
  end if;

  execute format(
    'update invoices set %s where id::text = %L returning to_jsonb(invoices.*)',
    array_to_string(v_set_parts, ', '),
    p_invoice_id
  ) into v_updated;

  return jsonb_build_object('ok', true, 'invoice', v_updated, 'open_balance', v_next);
end;
$$;

-- Lock down execution the same way as other service-role RPCs.
revoke execute on function insert_ar_ledger_entry(
  text, text, text, text, numeric, date, uuid, uuid
) from public, anon, authenticated;

revoke execute on function apply_invoice_balance_delta(
  text, numeric, numeric, uuid, uuid
) from public, anon, authenticated;

grant execute on function insert_ar_ledger_entry(
  text, text, text, text, numeric, date, uuid, uuid
) to service_role;

grant execute on function apply_invoice_balance_delta(
  text, numeric, numeric, uuid, uuid
) to service_role;
