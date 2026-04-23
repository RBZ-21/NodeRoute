const { supabase } = require('./supabase');

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

async function fetchInventoryByItemNumber(itemNumber) {
  const normalized = String(itemNumber || '').trim();
  if (!normalized) throw formatLedgerError('item_number is required', 'LEDGER_INVALID_ITEM');
  const { data, error } = await supabase
    .from('seafood_inventory')
    .select('*')
    .eq('item_number', normalized)
    .single();
  if (error || !data) {
    throw formatLedgerError(`Inventory item not found for ${normalized}`, 'LEDGER_ITEM_NOT_FOUND', { item_number: normalized });
  }
  return data;
}

async function applyInventoryLedgerEntry({
  itemNumber,
  deltaQty,
  changeType,
  notes = null,
  createdBy = 'system',
  lotId = null,
  unitCost = null,
  preventNegative = true,
  setAbsoluteQty = null,
}) {
  const item = await fetchInventoryByItemNumber(itemNumber);
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

  const updatePayload = {
    on_hand_qty: nextQty,
    on_hand_weight: nextQty,
    updated_at: nowIso,
  };
  if (nextCost !== prevCost) updatePayload.cost = nextCost;

  const { data: updated, error: updateErr } = await supabase
    .from('seafood_inventory')
    .update(updatePayload)
    .eq('item_number', item.item_number)
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
  };
  if (lotId) historyPayload.lot_id = lotId;

  const { error: historyErr } = await supabase
    .from('inventory_stock_history')
    .insert([historyPayload]);
  if (historyErr) {
    throw formatLedgerError(historyErr.message, 'LEDGER_HISTORY_FAILED', { item_number: item.item_number });
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
}) {
  const transferQty = roundQty(qty);
  if (transferQty <= 0) {
    throw formatLedgerError('qty must be > 0', 'LEDGER_INVALID_TRANSFER_QTY');
  }

  const source = await fetchInventoryByItemNumber(fromItemNumber);
  const destination = await fetchInventoryByItemNumber(toItemNumber);
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
};
