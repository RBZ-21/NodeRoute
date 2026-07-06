const { supabase } = require('./supabase');
const { buildScopeFields, executeWithOptionalScope } = require('./operating-context');

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundQty(value) {
  return parseFloat(toNumber(value, 0).toFixed(4));
}

function roundCost(value) {
  return parseFloat(toNumber(value, 0).toFixed(4));
}

function formatLedgerError(message, code = 'LEDGER_ERROR', meta = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, meta);
  return err;
}

function scopeQuery(query, context) {
  if (!context) return query;
  const scope = buildScopeFields(context);
  if (scope.company_id) query = query.eq('company_id', scope.company_id);
  if (scope.location_id) query = query.eq('location_id', scope.location_id);
  return query;
}

async function fetchInventoryByItemNumber(itemNumber, context = null) {
  const normalized = String(itemNumber || '').trim();
  if (!normalized) throw formatLedgerError('item_number is required', 'LEDGER_INVALID_ITEM');
  const query = supabase
    .from('products')
    .select('*')
    .eq('item_number', normalized);
  const { data, error } = await scopeQuery(query, context)
    .single();
  if (error || !data) {
    throw formatLedgerError(`Inventory item not found for ${normalized}`, 'LEDGER_ITEM_NOT_FOUND', { item_number: normalized });
  }
  return data;
}

// BE-001: detect "RPC not deployed" separately from real failures so we only
// fall back to the legacy path when the atomic function is genuinely absent.
function isMissingRpcError(error) {
  const code = String(error?.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('could not find the function') || message.includes('does not exist');
}

// BE-001: atomic DB-side path. The Postgres function locks the product row
// (SELECT ... FOR UPDATE), applies the guarded qty/cost math, and writes the
// inventory_stock_history row in the same transaction. Returns null when the
// RPC is unavailable (demo mode, offline resilient mode, or migration not yet
// applied) so the caller can fall back to the legacy non-atomic path.
async function tryApplyInventoryLedgerEntryRpc({
  itemNumber,
  deltaQty,
  changeType,
  notes,
  createdBy,
  lotId,
  unitCost,
  cost_basis,
  uom,
  conversion_factor,
  ledger_ref,
  preventNegative,
  setAbsoluteQty,
  context,
}) {
  if (typeof supabase.rpc !== 'function') return null;
  const scope = buildScopeFields(context || {});
  const rpcResult = await supabase.rpc('apply_inventory_ledger_entry', {
    p_item_number: itemNumber,
    p_delta_qty: toNumber(deltaQty, 0),
    p_set_absolute_qty: setAbsoluteQty == null ? null : roundQty(setAbsoluteQty),
    p_change_type: changeType == null ? null : String(changeType),
    p_notes: notes || null,
    p_created_by: createdBy || 'system',
    p_lot_id: lotId || null,
    p_unit_cost: Number.isFinite(toNumber(unitCost, NaN)) ? toNumber(unitCost, null) : null,
    p_cost_basis: cost_basis == null ? null : roundCost(cost_basis),
    p_uom: uom == null ? null : String(uom),
    p_conversion_factor: conversion_factor == null ? null : toNumber(conversion_factor, null),
    p_ledger_ref: ledger_ref == null ? null : String(ledger_ref),
    p_prevent_negative: preventNegative !== false,
    p_company_id: scope.company_id || null,
    p_location_id: scope.location_id || null,
  });

  if (rpcResult && rpcResult.error) {
    if (isMissingRpcError(rpcResult.error)) return null;
    throw formatLedgerError(rpcResult.error.message, 'LEDGER_UPDATE_FAILED', { item_number: itemNumber });
  }

  const payload = rpcResult && rpcResult.data;
  // Null data with no error means the resilient/demo client could not reach
  // the function — treat as unavailable rather than silently succeeding.
  if (!payload || typeof payload !== 'object') return null;

  if (payload.ok === false) {
    if (payload.code === 'LEDGER_NEGATIVE_STOCK') {
      throw formatLedgerError(
        `Insufficient stock for ${payload.item_number}: on hand ${payload.on_hand_qty}, requested delta ${payload.requested_delta}`,
        'LEDGER_NEGATIVE_STOCK',
        {
          item_number: payload.item_number,
          on_hand_qty: toNumber(payload.on_hand_qty, 0),
          requested_delta: toNumber(payload.requested_delta, 0),
        }
      );
    }
    if (payload.code === 'LEDGER_ITEM_NOT_FOUND') {
      throw formatLedgerError(
        `Inventory item not found for ${payload.item_number || itemNumber}`,
        'LEDGER_ITEM_NOT_FOUND',
        { item_number: payload.item_number || itemNumber }
      );
    }
    throw formatLedgerError(
      `Inventory ledger RPC failed with code ${payload.code || 'unknown'}`,
      payload.code || 'LEDGER_ERROR',
      { item_number: itemNumber }
    );
  }

  return {
    item_before: payload.item_before,
    item_after: payload.item_after,
    entry: payload.entry,
    qty_before: toNumber(payload.qty_before, 0),
    qty_after: toNumber(payload.qty_after, 0),
    cost_before: toNumber(payload.cost_before, 0),
    cost_after: toNumber(payload.cost_after, 0),
  };
}

async function applyInventoryLedgerEntry({
  itemNumber,
  deltaQty,
  changeType,
  notes = null,
  createdBy = 'system',
  lotId = null,
  unitCost = null,
  cost_basis = null,
  uom = null,
  conversion_factor = null,
  ledger_ref = null,
  preventNegative = true,
  setAbsoluteQty = null,
  context = null,
}) {
  const normalizedItemNumber = String(itemNumber || '').trim();
  if (!normalizedItemNumber) throw formatLedgerError('item_number is required', 'LEDGER_INVALID_ITEM');

  // BE-001: prefer the atomic DB-side operation whenever it is reachable.
  const rpcOutcome = await tryApplyInventoryLedgerEntryRpc({
    itemNumber: normalizedItemNumber,
    deltaQty,
    changeType,
    notes,
    createdBy,
    lotId,
    unitCost,
    cost_basis,
    uom,
    conversion_factor,
    ledger_ref,
    preventNegative,
    setAbsoluteQty,
    context,
  });
  if (rpcOutcome) return rpcOutcome;

  // Legacy fallback (demo mode / offline resilient mode only): the original
  // read-modify-write path. Single-process local state, so the concurrency
  // hazard the RPC eliminates does not apply here.
  const item = await fetchInventoryByItemNumber(normalizedItemNumber, context);
  const prevQty = roundQty(item.on_hand_qty);
  const nextQty = setAbsoluteQty != null
    ? roundQty(setAbsoluteQty)
    : roundQty(prevQty + toNumber(deltaQty, 0));
  const appliedDelta = roundQty(nextQty - prevQty);

  if (preventNegative && nextQty < 0) {
    throw formatLedgerError(
      `Insufficient stock for ${item.item_number}: on hand ${prevQty}, requested delta ${appliedDelta}`,
      'LEDGER_NEGATIVE_STOCK',
      { item_number: item.item_number, on_hand_qty: prevQty, requested_delta: appliedDelta }
    );
  }

  const nowIso = new Date().toISOString();
  const prevCost = roundCost(item.cost);
  let nextCost = prevCost;
  const normalizedCost = toNumber(unitCost, NaN);
  if (Number.isFinite(normalizedCost) && normalizedCost > 0 && appliedDelta > 0 && nextQty > 0) {
    nextCost = roundCost(((prevQty * prevCost) + (appliedDelta * normalizedCost)) / nextQty);
  }

  // on_hand_weight is a separate physical measurement — do NOT mirror on_hand_qty into it.
  // Writing to on_hand_weight caused "column can only be updated to default" errors.
  const updatePayload = {
    on_hand_qty: nextQty,
    updated_at: nowIso,
  };
  if (nextCost !== prevCost) updatePayload.cost = nextCost;

  const updateQuery = supabase
    .from('products')
    .update(updatePayload)
    .eq('item_number', item.item_number);
  const { data: updated, error: updateErr } = await scopeQuery(updateQuery, context)
    .select()
    .single();
  if (updateErr) {
    throw formatLedgerError(updateErr.message, 'LEDGER_UPDATE_FAILED', { item_number: item.item_number });
  }

  const historyPayload = {
    item_number: item.item_number,
    change_qty: appliedDelta,
    new_qty: nextQty,
    change_type: String(changeType || 'adjustment').trim() || 'adjustment',
    notes: notes || null,
    created_by: createdBy || 'system',
    cost_basis: cost_basis == null ? null : roundCost(cost_basis),
    uom: uom == null ? null : String(uom).trim() || null,
    conversion_factor: conversion_factor == null ? null : toNumber(conversion_factor, null),
    ledger_ref: ledger_ref == null ? null : String(ledger_ref),
    ...buildScopeFields(context || {}, {
      company_id: item.company_id || undefined,
      location_id: item.location_id || undefined,
    }),
  };
  if (lotId) historyPayload.lot_id = lotId;

  const historyResult = await executeWithOptionalScope(
    (candidate) => supabase.from('inventory_stock_history').insert([candidate]),
    historyPayload
  );
  if (historyResult.error) {
    throw formatLedgerError(historyResult.error.message, 'LEDGER_HISTORY_FAILED', { item_number: item.item_number });
  }

  return {
    item_before: item,
    item_after: updated || { ...item, ...updatePayload },
    entry: historyPayload,
    qty_before: prevQty,
    qty_after: nextQty,
    cost_before: prevCost,
    cost_after: nextCost,
  };
}

async function transferInventoryLedgerEntry({
  fromItemNumber,
  toItemNumber,
  qty,
  notes = null,
  createdBy = 'system',
  context = null,
}) {
  const transferQty = roundQty(qty);
  if (transferQty <= 0) {
    throw formatLedgerError('qty must be > 0', 'LEDGER_INVALID_TRANSFER_QTY');
  }

  const source = await fetchInventoryByItemNumber(fromItemNumber, context);
  const destination = await fetchInventoryByItemNumber(toItemNumber, context);
  if (source.item_number === destination.item_number) {
    throw formatLedgerError('from_item_number and to_item_number must be different', 'LEDGER_INVALID_TRANSFER_TARGET');
  }

  if (roundQty(source.on_hand_qty) < transferQty) {
    throw formatLedgerError(
      `Insufficient stock to transfer ${transferQty} from ${source.item_number}`,
      'LEDGER_NEGATIVE_STOCK',
      { item_number: source.item_number, on_hand_qty: roundQty(source.on_hand_qty), requested_delta: -transferQty }
    );
  }

  const transferRef = `transfer:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  const sourceResult = await applyInventoryLedgerEntry({
    itemNumber: source.item_number,
    deltaQty: -transferQty,
    changeType: 'transfer_out',
    notes: `${notes || 'Inventory transfer'} · ${transferRef} · to ${destination.item_number}`,
    createdBy,
    preventNegative: true,
    context,
  });

  try {
    const destinationResult = await applyInventoryLedgerEntry({
      itemNumber: destination.item_number,
      deltaQty: transferQty,
      changeType: 'transfer_in',
      notes: `${notes || 'Inventory transfer'} · ${transferRef} · from ${source.item_number}`,
      createdBy,
      unitCost: sourceResult.cost_after || sourceResult.cost_before || 0,
      preventNegative: false,
      context,
    });
    return { transfer_ref: transferRef, source: sourceResult, destination: destinationResult };
  } catch (error) {
    try {
      await applyInventoryLedgerEntry({
        itemNumber: source.item_number,
        deltaQty: transferQty,
        changeType: 'transfer_reversal',
        notes: `Auto-reversal for failed transfer ${transferRef}`,
        createdBy: 'system',
        preventNegative: false,
        context,
      });
    } catch (_ignored) {
      // Best-effort reversal in non-transactional demo/supabase mode.
    }
    throw error;
  }
}

module.exports = {
  fetchInventoryByItemNumber,
  applyInventoryLedgerEntry,
  transferInventoryLedgerEntry,
  formatLedgerError,
  toNumber,
  isMissingRpcError,
};
