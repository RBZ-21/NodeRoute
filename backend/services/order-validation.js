'use strict';

// Order-level pricing validation, extracted from routes/orders.js.
//
// validateOrderItemPricing() checks every line item on an order against the
// minimum-sell rules engine. It replaces what used to be an inline loop in
// orders.js that called pricingEngine.enforceMinimumSell() once per item
// (each call issuing its own product + minimum_sell_rules queries). Here we
// batch all of that into a fixed number of queries via
// pricingEngine.enforceMinimumSellBatch(), regardless of how many items are
// on the order.

const { supabase } = require('./supabase');
const pricingEngine = require('./pricing-engine');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function lineProductRef(item) {
  return {
    productId: normalizeText(item?.product_id || item?.productId),
    itemNumber: normalizeText(item?.item_number || item?.itemNumber),
  };
}

function lineUnitPrice(item) {
  if (item?.is_catch_weight) return parseFloat(item.price_per_lb ?? item.unit_price ?? item.price ?? 0) || 0;
  return parseFloat(item?.unit_price ?? item?.unitPrice ?? item?.price ?? item?.price_per_lb ?? 0) || 0;
}

// Returns the same shape the old per-item findMinimumSellViolation()
// returned: null when every item clears its minimum-sell price, or
// { item, min_price, source_id } describing the first violating item
// (in input order) otherwise.
async function validateOrderItemPricing(items, context, options = {}) {
  const db = options.db || supabase;
  const list = Array.isArray(items) ? items : [];

  // Build the batch input, remembering which original item each ref came
  // from so we can map results back and preserve "first violation wins" in
  // input order, matching the previous sequential-loop behavior.
  const refs = [];
  const refIndexToItem = [];
  for (const item of list) {
    const { productId, itemNumber } = lineProductRef(item);
    if (!productId && !itemNumber) continue;
    refs.push({ productId, itemNumber, price: lineUnitPrice(item) });
    refIndexToItem.push(item);
  }

  if (!refs.length) return null;

  const results = await pricingEngine.enforceMinimumSellBatch({ db, context, refs });

  for (let i = 0; i < refs.length; i += 1) {
    const result = results.get(i);
    if (result && !result.allowed) {
      return {
        item: refIndexToItem[i],
        min_price: result.min_price,
        source_id: result.source_id,
      };
    }
  }
  return null;
}

module.exports = {
  validateOrderItemPricing,
};
