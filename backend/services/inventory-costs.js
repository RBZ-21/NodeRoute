'use strict';

const { supabase } = require('./supabase');
const { scopeQueryByContext } = require('./operating-context');

const COST_FIELDS = ['real_cost', 'landed_cost', 'base_cost', 'lot_cost', 'market_cost'];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundCost(value) {
  return Number(toNumber(value, 0).toFixed(4));
}

async function computeWeightedAverageCost(productId, locationId = null, context = null) {
  const id = String(productId || '').trim();
  if (!id) throw new Error('productId is required');

  let query = supabase
    .from('inventory_lots')
    .select('product_id,item_number,qty_on_hand,lot_cost,cost_per_unit,status,company_id,location_id')
    .eq('status', 'active');
  query = scopeQueryByContext(query, context);
  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).filter((lot) =>
    String(lot.product_id || '') === id || String(lot.item_number || '') === id
  );
  const totals = rows.reduce((acc, lot) => {
    const qty = Math.max(0, toNumber(lot.qty_on_hand, 0));
    const cost = toNumber(lot.lot_cost ?? lot.cost_per_unit, NaN);
    if (!qty || !Number.isFinite(cost)) return acc;
    acc.qty += qty;
    acc.value += qty * cost;
    return acc;
  }, { qty: 0, value: 0 });

  return totals.qty > 0 ? roundCost(totals.value / totals.qty) : null;
}

async function updateLotCosts(lotId, costFields, context = null) {
  const id = String(lotId || '').trim();
  if (!id) throw new Error('lotId is required');
  const patch = {};
  for (const key of COST_FIELDS) {
    if (costFields?.[key] === undefined) continue;
    const numeric = Number(costFields[key]);
    if (!Number.isFinite(numeric)) throw new Error(`${key} must be numeric`);
    patch[key] = roundCost(numeric);
  }
  if (!Object.keys(patch).length) throw new Error('No cost fields provided');

  const { data, error } = await scopeQueryByContext(
    supabase.from('inventory_lots').update(patch),
    context,
  )
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  COST_FIELDS,
  computeWeightedAverageCost,
  updateLotCosts,
};
