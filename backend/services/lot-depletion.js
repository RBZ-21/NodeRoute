'use strict';

/**
 * FEFO lot depletion — depletes active lots in ascending expiry order,
 * then by created_at for ties (oldest lot first when no expiry is set).
 * Returns { depleted: [{lot_id, lot_number, qty_taken}], remaining: number }
 * remaining > 0 means lots ran out before totalQty was satisfied.
 */
// BE-001: detect "RPC not deployed" separately from real failures.
function isMissingRpcError(error) {
  const code = String(error?.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('could not find the function') || message.includes('does not exist');
}

async function depleteLotsFefo(supabase, itemNumber, totalQty, { createdBy, context }) {
  // BE-001: prefer the atomic DB-side depletion (row locks + single txn in
  // deplete_lots_fefo). Falls through to the legacy per-lot loop when the RPC
  // is unavailable (demo mode, offline resilient mode, or migration not yet
  // applied) — the demo path is single-process, so the concurrency hazard the
  // RPC eliminates does not apply there.
  if (typeof supabase.rpc === 'function') {
    const rpcResult = await supabase.rpc('deplete_lots_fefo', {
      p_item_number: itemNumber,
      p_total_qty: parseFloat(totalQty),
    });
    if (rpcResult && rpcResult.error && !isMissingRpcError(rpcResult.error)) {
      throw new Error(rpcResult.error.message);
    }
    const payload = rpcResult && rpcResult.data;
    if (payload && typeof payload === 'object' && Array.isArray(payload.depleted)) {
      return {
        depleted: payload.depleted.map((entry) => ({
          lot_id: entry.lot_id,
          lot_number: entry.lot_number,
          qty_taken: parseFloat(entry.qty_taken) || 0,
        })),
        remaining: parseFloat(payload.remaining) || 0,
      };
    }
  }

  let remaining = parseFloat(totalQty);
  const depleted = [];

  const { data: lots, error } = await supabase
    .from('inventory_lots')
    .select('*')
    .eq('item_number', itemNumber)
    .eq('status', 'active')
    .gt('qty_on_hand', 0)
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  if (!lots || !lots.length) return { depleted, remaining };

  for (const lot of lots) {
    if (remaining <= 0) break;
    const available = parseFloat(lot.qty_on_hand) || 0;
    const take = parseFloat(Math.min(remaining, available).toFixed(4));
    const newQty = parseFloat((available - take).toFixed(4));
    const newStatus = newQty <= 0 ? 'depleted' : lot.status;

    const { error: updErr } = await supabase
      .from('inventory_lots')
      .update({ qty_on_hand: newQty, status: newStatus })
      .eq('id', lot.id);

    if (updErr) throw new Error(updErr.message);

    depleted.push({ lot_id: lot.id, lot_number: lot.lot_number, qty_taken: take });
    remaining = parseFloat((remaining - take).toFixed(4));
  }

  return { depleted, remaining };
}

module.exports = { depleteLotsFefo };
