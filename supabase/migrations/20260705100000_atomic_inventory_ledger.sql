-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260705100000_atomic_inventory_ledger
-- Finding  : BE-001 (Root Depth Scan, commit 904d7119)
-- Purpose  : Move inventory stock/lot mutations into atomic DB-side operations.
--            Previously backend/services/inventory-ledger.js read on_hand_qty,
--            computed the next value in JS, and wrote an absolute value back
--            with no transaction/lock/CAS — concurrent movements could lose
--            updates or drive stock negative, and the products update and
--            inventory_stock_history insert could desync.
--
--            apply_inventory_ledger_entry: SELECT ... FOR UPDATE on the product
--            row, guarded qty math, weighted-average cost update, and the
--            stock-history insert all inside one function (= one transaction).
--
--            deplete_lots_fefo: FEFO lot depletion with row locks, replacing
--            the per-lot read-then-write loop in lot-depletion.js.
--
-- security definer: runs as the function owner (matches the existing
-- sync_route_stop_assignments pattern) so the backend service-role path is
-- unchanged. search_path pinned per project convention.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function apply_inventory_ledger_entry(
  p_item_number       text,
  p_delta_qty         numeric  default 0,
  p_set_absolute_qty  numeric  default null,
  p_change_type       text     default 'adjustment',
  p_notes             text     default null,
  p_created_by        text     default 'system',
  p_lot_id            uuid     default null,
  p_unit_cost         numeric  default null,
  p_cost_basis        numeric  default null,
  p_uom               text     default null,
  p_conversion_factor numeric  default null,
  p_ledger_ref        text     default null,
  p_prevent_negative  boolean  default true,
  p_company_id        uuid     default null,
  p_location_id       uuid     default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item          products%rowtype;
  v_updated       products%rowtype;
  v_match_count   integer;
  v_prev_qty      numeric;
  v_next_qty      numeric;
  v_applied_delta numeric;
  v_prev_cost     numeric;
  v_next_cost     numeric;
  v_entry_id      uuid;
  v_entry         jsonb;
begin
  if p_item_number is null or trim(p_item_number) = '' then
    return jsonb_build_object('ok', false, 'code', 'LEDGER_INVALID_ITEM');
  end if;

  -- Mirror the JS .single() semantics: exactly one match or item-not-found.
  select count(*) into v_match_count
  from products
  where item_number = trim(p_item_number)
    and (p_company_id  is null or company_id  = p_company_id)
    and (p_location_id is null or location_id = p_location_id);

  if v_match_count <> 1 then
    return jsonb_build_object(
      'ok', false, 'code', 'LEDGER_ITEM_NOT_FOUND',
      'item_number', trim(p_item_number)
    );
  end if;

  -- Row-level lock: serializes concurrent movements on this product.
  select * into v_item
  from products
  where item_number = trim(p_item_number)
    and (p_company_id  is null or company_id  = p_company_id)
    and (p_location_id is null or location_id = p_location_id)
  for update;

  v_prev_qty := round(coalesce(v_item.on_hand_qty, 0), 4);
  if p_set_absolute_qty is not null then
    v_next_qty := round(p_set_absolute_qty, 4);
  else
    v_next_qty := round(v_prev_qty + coalesce(p_delta_qty, 0), 4);
  end if;
  v_applied_delta := round(v_next_qty - v_prev_qty, 4);

  if p_prevent_negative and v_next_qty < 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'LEDGER_NEGATIVE_STOCK',
      'item_number', v_item.item_number,
      'on_hand_qty', v_prev_qty,
      'requested_delta', v_applied_delta
    );
  end if;

  -- Weighted-average cost, matching the JS logic exactly.
  v_prev_cost := round(coalesce(v_item.cost, 0), 4);
  v_next_cost := v_prev_cost;
  if p_unit_cost is not null and p_unit_cost > 0
     and v_applied_delta > 0 and v_next_qty > 0 then
    v_next_cost := round(
      ((v_prev_qty * v_prev_cost) + (v_applied_delta * p_unit_cost)) / v_next_qty,
      4
    );
  end if;

  -- NOTE: on_hand_weight is a separate physical measurement — intentionally
  -- not touched here (see comment in inventory-ledger.js).
  update products
  set on_hand_qty = v_next_qty,
      cost        = case when v_next_cost <> v_prev_cost then v_next_cost else cost end,
      updated_at  = now()
  where id = v_item.id
  returning * into v_updated;

  -- Same transaction as the stock update: they can no longer desync.
  insert into inventory_stock_history (
    item_number, change_qty, new_qty, change_type, notes, created_by,
    cost_basis, uom, conversion_factor, ledger_ref, lot_id,
    company_id, location_id
  ) values (
    v_item.item_number,
    v_applied_delta,
    v_next_qty,
    coalesce(nullif(trim(coalesce(p_change_type, '')), ''), 'adjustment'),
    p_notes,
    coalesce(nullif(trim(coalesce(p_created_by, '')), ''), 'system'),
    case when p_cost_basis is null then null else round(p_cost_basis, 4) end,
    nullif(trim(coalesce(p_uom, '')), ''),
    p_conversion_factor,
    p_ledger_ref,
    p_lot_id,
    coalesce(v_item.company_id, p_company_id),   -- item scope wins (buildScopeFields overrides)
    coalesce(v_item.location_id, p_location_id)
  )
  returning id into v_entry_id;

  select to_jsonb(h) into v_entry
  from inventory_stock_history h
  where h.id = v_entry_id;

  return jsonb_build_object(
    'ok',          true,
    'item_before', to_jsonb(v_item),
    'item_after',  to_jsonb(v_updated),
    'entry',       v_entry,
    'qty_before',  v_prev_qty,
    'qty_after',   v_next_qty,
    'cost_before', v_prev_cost,
    'cost_after',  v_next_cost
  );
end;
$$;

create or replace function deplete_lots_fefo(
  p_item_number text,
  p_total_qty   numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric := round(coalesce(p_total_qty, 0), 4);
  v_depleted  jsonb   := '[]'::jsonb;
  v_lot       inventory_lots%rowtype;
  v_take      numeric;
  v_new_qty   numeric;
begin
  -- FEFO: earliest expiry first, nulls last, created_at breaks ties.
  -- FOR UPDATE locks each candidate lot row for the duration of the txn.
  for v_lot in
    select *
    from inventory_lots
    where item_number = p_item_number
      and status = 'active'
      and qty_on_hand > 0
    order by expiry_date asc nulls last, created_at asc
    for update
  loop
    exit when v_remaining <= 0;

    v_take    := round(least(v_remaining, coalesce(v_lot.qty_on_hand, 0)), 4);
    v_new_qty := round(coalesce(v_lot.qty_on_hand, 0) - v_take, 4);

    update inventory_lots
    set qty_on_hand = v_new_qty,
        status      = case when v_new_qty <= 0 then 'depleted' else status end
    where id = v_lot.id;

    v_depleted := v_depleted || jsonb_build_object(
      'lot_id',     v_lot.id,
      'lot_number', v_lot.lot_number,
      'qty_taken',  v_take
    );
    v_remaining := round(v_remaining - v_take, 4);
  end loop;

  return jsonb_build_object('ok', true, 'depleted', v_depleted, 'remaining', v_remaining);
end;
$$;

-- Lock down execution the same way as other service-role RPCs.
revoke execute on function apply_inventory_ledger_entry(
  text, numeric, numeric, text, text, text, uuid, numeric, numeric,
  text, numeric, text, boolean, uuid, uuid
) from public, anon, authenticated;

revoke execute on function deplete_lots_fefo(text, numeric) from public, anon, authenticated;

grant execute on function apply_inventory_ledger_entry(
  text, numeric, numeric, text, text, text, uuid, numeric, numeric,
  text, numeric, text, boolean, uuid, uuid
) to service_role;

grant execute on function deplete_lots_fefo(text, numeric) to service_role;
