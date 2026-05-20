'use strict';

/**
 * FEFO lot depletion — depletes active lots in ascending expiry order,
 * then by created_at for ties (oldest lot first when no expiry is set).
 * Returns { depleted: [{lot_id, lot_number, qty_taken}], remaining: number }
 * remaining > 0 means lots ran out before totalQty was satisfied.
 */
async function depleteLotsFefo(supabase, itemNumber, totalQty, { createdBy, context }) {
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
