'use strict';

const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('./operating-context');

const PRICE_METHODS = {
  QUOTE: 'quote',
  CUSTOMER_SPECIAL: 'customer_special',
  PROMOTION: 'promotion',
  PRICE_LEVEL: 'price_level',
  LIST: 'list',
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundPrice(value) {
  return Number((toNumber(value, 0)).toFixed(4));
}

function activeOnDate(row, onDate, startField, endField) {
  const date = String(onDate || todayIsoDate()).slice(0, 10);
  const start = row?.[startField] ? String(row[startField]).slice(0, 10) : null;
  const end = row?.[endField] ? String(row[endField]).slice(0, 10) : null;
  if (start && start > date) return false;
  if (end && end < date) return false;
  return true;
}

function productCategoryKeys(product) {
  return [
    normalizeText(product?.category_id),
    normalizeText(product?.category),
    normalizeText(product?.class_id),
    normalizeText(product?.class_name),
  ].filter(Boolean);
}

function productCost(product) {
  for (const key of ['real_cost', 'cost_real', 'landed_cost', 'lot_cost', 'market_cost', 'cost_base', 'base_cost', 'cost']) {
    const value = toNumber(product?.[key], NaN);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function productListPrice(product) {
  for (const key of ['price_per_unit', 'list_price', 'default_price_per_lb', 'unit_price', 'cost']) {
    const value = toNumber(product?.[key], NaN);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function sortById(a, b) {
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function moreSpecificFirst(a, b) {
  const aScore = a?.product_id ? 2 : 1;
  const bScore = b?.product_id ? 2 : 1;
  if (aScore !== bScore) return bScore - aScore;
  return sortById(a, b);
}

function queryWithCompanyFallback(query, companyId) {
  return companyId ? query.eq('company_id', companyId) : query;
}

async function loadProduct(db, { productId, itemNumber, context }) {
  const normalizedProductId = normalizeText(productId).replace(/^item:/, '');
  const normalizedItemNumber = normalizeText(itemNumber);
  const candidates = [];

  if (normalizedProductId && !String(productId).startsWith('item:')) {
    const { data, error } = await scopeQueryByContext(
      db.from('products').select('*'),
      context,
    )
      .eq('id', normalizedProductId)
      .limit(1);
    if (error) throw error;
    candidates.push(...filterRowsByContext(data || [], context));
  }

  const fallbackItemNumber = normalizedItemNumber || (String(productId || '').startsWith('item:') ? normalizedProductId : '');
  if (!candidates.length && fallbackItemNumber) {
    const { data, error } = await scopeQueryByContext(
      db.from('products').select('*'),
      context,
    )
      .eq('item_number', fallbackItemNumber)
      .limit(1);
    if (error) throw error;
    candidates.push(...filterRowsByContext(data || [], context));
  }

  return candidates[0] || null;
}

function calculateRulePrice(rule, product, listPrice) {
  const value = toNumber(rule?.value, 0);
  const cost = productCost(product);
  if (rule?.method === 'fixed_dollar') return roundPrice(value);
  if (rule?.method === 'percent_of_cost') return roundPrice(cost * (1 + value / 100));
  if (rule?.method === 'percent_of_list') return roundPrice(listPrice * (value / 100));
  if (rule?.method === 'dollar_over_cost') return roundPrice(cost + value);
  return null;
}

function calculatePromotionPrice(promotion, item, listPrice) {
  const value = toNumber(item?.value, 0);
  if (promotion?.promo_type === 'sale_price') return roundPrice(value);
  if (promotion?.promo_type === 'percent_off') return roundPrice(Math.max(0, listPrice * (1 - value / 100)));
  if (promotion?.promo_type === 'dollar_off') return roundPrice(Math.max(0, listPrice - value));
  return null;
}

function targetMatchesProduct(row, product, categoryKeys = productCategoryKeys(product)) {
  if (row?.product_id && String(row.product_id) === String(product?.id)) return true;
  if (row?.category_id && categoryKeys.includes(String(row.category_id))) return true;
  return false;
}

async function resolveQuotePrice(db, { customerId, product, qty, uom, context, onDate }) {
  const { data: quoteRows, error: quoteErr } = await scopeQueryByContext(
    db.from('quotes').select('*'),
    context,
  )
    .eq('customer_id', customerId)
    .eq('status', 'active');
  if (quoteErr) throw quoteErr;

  const quotes = filterRowsByContext(quoteRows || [], context)
    .filter((quote) => activeOnDate(quote, onDate, 'valid_from', 'valid_until'))
    .sort(sortById);
  const quoteIds = quotes.map((quote) => quote.id).filter(Boolean);
  if (!quoteIds.length) return null;

  const { data: itemRows, error: itemErr } = await scopeQueryByContext(
    db.from('quote_items').select('*'),
    context,
  )
    .in('quote_id', quoteIds)
    .eq('product_id', product.id);
  if (itemErr) throw itemErr;

  const requestedQty = toNumber(qty, 0);
  const requestedUom = normalizeText(uom).toLowerCase();
  const items = filterRowsByContext(itemRows || [], context)
    .filter((item) => !item.min_qty || toNumber(item.min_qty, 0) <= requestedQty)
    .filter((item) => !normalizeText(item.uom) || !requestedUom || normalizeText(item.uom).toLowerCase() === requestedUom)
    .sort((a, b) => {
      const priceDelta = toNumber(a.quoted_price, 0) - toNumber(b.quoted_price, 0);
      return priceDelta || sortById(a, b);
    });
  if (!items.length) return null;
  return {
    price: roundPrice(items[0].quoted_price),
    method: PRICE_METHODS.QUOTE,
    source_id: items[0].id,
  };
}

async function resolveCustomerSpecialPrice(db, { customerId, product, context, onDate }) {
  const { data, error } = await scopeQueryByContext(
    db.from('customer_special_prices').select('*'),
    context,
  )
    .eq('customer_id', customerId)
    .eq('product_id', product.id);
  if (error) throw error;

  const rows = filterRowsByContext(data || [], context)
    .filter((row) => activeOnDate(row, onDate, 'effective_date', 'expiry_date'))
    .sort((a, b) => {
      const dateCompare = String(b.effective_date || '').localeCompare(String(a.effective_date || ''));
      const priceCompare = toNumber(a.special_price, 0) - toNumber(b.special_price, 0);
      return dateCompare || priceCompare || sortById(a, b);
    });
  if (!rows.length) return null;
  return {
    price: roundPrice(rows[0].special_price),
    method: PRICE_METHODS.CUSTOMER_SPECIAL,
    source_id: rows[0].id,
  };
}

async function resolvePromotionPrice(db, { product, context, onDate, listPrice }) {
  const { data: promoRows, error: promoErr } = await scopeQueryByContext(
    db.from('promotions').select('*'),
    context,
  )
    .eq('status', 'active');
  if (promoErr) throw promoErr;

  const promotions = filterRowsByContext(promoRows || [], context)
    .filter((promo) => activeOnDate(promo, onDate, 'start_date', 'end_date'));
  if (!promotions.length) return null;
  const promotionsById = new Map(promotions.map((promo) => [String(promo.id), promo]));

  const { data: itemRows, error: itemErr } = await scopeQueryByContext(
    db.from('promotion_items').select('*'),
    context,
  )
    .in('promotion_id', [...promotionsById.keys()]);
  if (itemErr) throw itemErr;

  const candidates = filterRowsByContext(itemRows || [], context)
    .filter((item) => targetMatchesProduct(item, product))
    .map((item) => {
      const promotion = promotionsById.get(String(item.promotion_id));
      const price = calculatePromotionPrice(promotion, item, listPrice);
      return price == null ? null : { item, price };
    })
    .filter(Boolean)
    .sort((a, b) => (a.price - b.price) || sortById(a.item, b.item));

  if (!candidates.length) return null;
  return {
    price: roundPrice(candidates[0].price),
    method: PRICE_METHODS.PROMOTION,
    source_id: candidates[0].item.id,
  };
}

async function resolvePriceLevelPrice(db, { customerId, product, context, onDate, listPrice }) {
  const { data: assignmentRows, error: assignmentErr } = await scopeQueryByContext(
    db.from('customer_price_level_assignments').select('*'),
    context,
  )
    .eq('customer_id', customerId);
  if (assignmentErr) throw assignmentErr;

  const assignments = filterRowsByContext(assignmentRows || [], context)
    .filter((row) => activeOnDate(row, onDate, 'effective_date', 'expiry_date'))
    .sort((a, b) => String(b.effective_date || '').localeCompare(String(a.effective_date || '')) || sortById(a, b));

  if (!assignments.length) return null;

  const priceLevelIds = [...new Set(assignments.map((row) => row.price_level_id).filter(Boolean))];
  const { data: allRuleRows, error: ruleErr } = await scopeQueryByContext(
    db.from('price_level_rules').select('*'),
    context,
  )
    .in('price_level_id', priceLevelIds);
  if (ruleErr) throw ruleErr;

  const rulesByLevel = new Map();
  for (const rule of filterRowsByContext(allRuleRows || [], context)) {
    const list = rulesByLevel.get(rule.price_level_id) || [];
    list.push(rule);
    rulesByLevel.set(rule.price_level_id, list);
  }

  for (const assignment of assignments) {
    const rules = (rulesByLevel.get(assignment.price_level_id) || [])
      .filter((rule) => targetMatchesProduct(rule, product))
      .sort(moreSpecificFirst);
    for (const rule of rules) {
      const price = calculateRulePrice(rule, product, listPrice);
      if (price != null) {
        return {
          price,
          method: PRICE_METHODS.PRICE_LEVEL,
          source_id: rule.id,
        };
      }
    }
  }

  return null;
}

function normalizeResolveArgs(customerIdOrArgs, productId, qty, uom, context) {
  if (customerIdOrArgs && typeof customerIdOrArgs === 'object') return { ...customerIdOrArgs };
  const { supabase } = require('./supabase');
  return {
    db: supabase,
    customerId: customerIdOrArgs,
    productId,
    qty,
    uom,
    context,
  };
}

async function resolvePrice(customerIdOrArgs, productId, qty, uom, context) {
  const args = normalizeResolveArgs(customerIdOrArgs, productId, qty, uom, context);
  const db = args.db;
  if (!db) throw new Error('resolvePrice requires a db client');

  const onDate = String(args.onDate || todayIsoDate()).slice(0, 10);
  const product = await loadProduct(db, args);
  if (!product) return { price: 0, method: 'not_found', source_id: null };

  const listPrice = roundPrice(productListPrice(product));
  const orderedResolvers = [
    resolveQuotePrice,
    resolveCustomerSpecialPrice,
    resolvePromotionPrice,
    resolvePriceLevelPrice,
  ];

  for (const resolver of orderedResolvers) {
    const result = await resolver(db, { ...args, product, onDate, listPrice });
    if (result) return result;
  }

  return {
    price: listPrice,
    method: PRICE_METHODS.LIST,
    source_id: product.id || null,
  };
}

function normalizeMinimumArgs(priceOrArgs, productId, companyId) {
  if (priceOrArgs && typeof priceOrArgs === 'object') return { ...priceOrArgs };
  const { supabase } = require('./supabase');
  return {
    db: supabase,
    price: priceOrArgs,
    productId,
    companyId,
  };
}

async function enforceMinimumSell(priceOrArgs, productId, companyId) {
  const args = normalizeMinimumArgs(priceOrArgs, productId, companyId);
  const db = args.db;
  if (!db) throw new Error('enforceMinimumSell requires a db client');

  const product = await loadProduct(db, args);
  if (!product) return { allowed: true, min_price: null, source_id: null };

  let query = db.from('minimum_sell_rules').select('*');
  query = args.context ? scopeQueryByContext(query, args.context) : queryWithCompanyFallback(query, args.companyId || product.company_id);
  const { data, error } = await query;
  if (error) throw error;

  const categoryKeys = productCategoryKeys(product);
  const rules = filterRowsByContext(data || [], args.context)
    .filter((rule) => targetMatchesProduct(rule, product, categoryKeys))
    .sort(moreSpecificFirst);
  if (!rules.length) return { allowed: true, min_price: null, source_id: null };

  const cost = productCost(product);
  let minPrice = 0;
  let sourceId = null;
  for (const rule of rules) {
    const explicitMin = toNumber(rule.min_price, NaN);
    if (Number.isFinite(explicitMin)) {
      minPrice = Math.max(minPrice, explicitMin);
      if (minPrice === explicitMin) sourceId = rule.id;
    }
    const marginPct = toNumber(rule.min_margin_pct, NaN);
    if (Number.isFinite(marginPct) && marginPct >= 0 && marginPct < 100 && cost > 0) {
      const marginPrice = cost / (1 - marginPct / 100);
      if (marginPrice > minPrice) {
        minPrice = marginPrice;
        sourceId = rule.id;
      }
    }
  }

  const roundedMin = roundPrice(minPrice);
  return {
    allowed: toNumber(args.price, 0) + 0.0001 >= roundedMin,
    min_price: roundedMin,
    source_id: sourceId,
  };
}

async function logPriceUpdate(batchIdOrArgs, productId, costField, oldValue, newValue) {
  const args = batchIdOrArgs && typeof batchIdOrArgs === 'object'
    ? { ...batchIdOrArgs }
    : { batchId: batchIdOrArgs, productId, costField, oldValue, newValue };
  const db = args.db || require('./supabase').supabase;
  const record = {
    batch_id: args.batchId,
    product_id: args.productId,
    cost_field: args.costField,
    old_value: args.oldValue,
    new_value: args.newValue,
    new_sell_price: args.newSellPrice ?? null,
  };
  if (args.companyId && !args.context) record.company_id = args.companyId;
  if (args.context) {
    return insertRecordWithOptionalScope(db, 'pricing_update_batch_items', record, args.context);
  }
  return db.from('pricing_update_batch_items').insert([record]).select().single();
}

function buildScopedInsert(record, context) {
  return buildScopeFields(context || {}, record);
}

module.exports = {
  PRICE_METHODS,
  buildScopedInsert,
  calculatePromotionPrice,
  calculateRulePrice,
  enforceMinimumSell,
  logPriceUpdate,
  productCost,
  productListPrice,
  resolvePrice,
};
