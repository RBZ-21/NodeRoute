'use strict';

const Decimal = require('decimal.js');
const { supabase } = require('./supabase');
const logger = require('./logger');
const { buildScopeFields, filterRowsByContext } = require('./operating-context');
const {
  scoreReorderConfidence,
  enhanceReorderReason,
} = require('./ai');

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const DAY_MS = 86_400_000;
const REVIEW_PERIOD_DAYS = 7;
const USAGE_CHANGE_THRESHOLD = new Decimal('0.10');

function D(value, fallback = 0) {
  try {
    if (value === null || value === undefined || value === '') return new Decimal(fallback);
    const next = new Decimal(value);
    return next.isFinite() ? next : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

function n(value, places = 4) {
  return Number(D(value).toDecimalPlaces(places).toString());
}

function s(value, places = 4) {
  return D(value).toDecimalPlaces(places).toFixed(places);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

function addDaysIso(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

function weekOfYear(dateValue) {
  const date = new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
}

function currentWeekOfYear() {
  return weekOfYear(new Date());
}

function productName(product) {
  return product?.name || product?.description || product?.item_number || 'Unknown product';
}

function productUnit(product) {
  return product?.unit || product?.default_unit || product?.catch_weight_unit || 'units';
}

async function fetchProduct(productId) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();
  if (error || !data) throw new Error(error?.message || 'Product not found');
  return data;
}

async function fetchUsage(productId, sinceDate = null) {
  let query = supabase
    .from('product_usage_history')
    .select('*')
    .eq('product_id', productId)
    .order('recorded_date', { ascending: true });
  if (sinceDate) query = query.gte('recorded_date', sinceDate);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

function trendFromSeries(rows) {
  if (!rows.length) return 'stable';
  const split = Math.max(1, Math.floor(rows.length / 2));
  const early = rows.slice(0, split);
  const late = rows.slice(-split);
  const earlyAvg = early.reduce((sum, row) => sum.plus(D(row.units_used)), new Decimal(0)).div(early.length || 1);
  const lateAvg = late.reduce((sum, row) => sum.plus(D(row.units_used)), new Decimal(0)).div(late.length || 1);
  if (earlyAvg.eq(0) && lateAvg.gt(0)) return 'rising';
  if (earlyAvg.eq(0)) return 'stable';
  const ratio = lateAvg.div(earlyAvg);
  if (ratio.gte('1.15')) return 'rising';
  if (ratio.lte('0.85')) return 'falling';
  return 'stable';
}

async function calculateAvgDailyUsage(productId, days = 30) {
  const product = await fetchProduct(productId);
  const rows = await fetchUsage(productId, daysAgoIso(days));
  const historyDays = rows.length;
  if (!historyDays) {
    const fallback = D(product.avg_daily_usage);
    return {
      product_id: productId,
      simple_average: n(fallback),
      weighted_average: n(fallback),
      selected_average: n(fallback),
      trend: product.usage_trend || 'stable',
      days_of_history_available: 0,
      confidence: fallback.gt(0) ? 'manual_fallback' : 'no_history',
    };
  }

  const total = rows.reduce((sum, row) => sum.plus(D(row.units_used)), new Decimal(0));
  const simple = total.div(historyDays);
  let weightedTotal = new Decimal(0);
  let weightTotal = new Decimal(0);
  rows.forEach((row, index) => {
    const weight = new Decimal(index + 1);
    weightedTotal = weightedTotal.plus(D(row.units_used).times(weight));
    weightTotal = weightTotal.plus(weight);
  });
  const weighted = weightTotal.gt(0) ? weightedTotal.div(weightTotal) : simple;
  return {
    product_id: productId,
    simple_average: n(simple),
    weighted_average: n(weighted),
    selected_average: n(weighted),
    trend: trendFromSeries(rows),
    days_of_history_available: historyDays,
    confidence: historyDays < 7 ? 'low_confidence' : 'normal',
  };
}

async function detectSeasonality(productId) {
  const rows = await fetchUsage(productId);
  const uniqueDates = new Set(rows.map((row) => row.recorded_date));
  if (uniqueDates.size < 365) {
    return {
      seasonal_multiplier: 1,
      seasonal_adjustment_pct: 0,
      confidence: 'insufficient_history',
      weeks_analyzed: 0,
    };
  }

  const weekly = new Map();
  rows.forEach((row) => {
    const key = Number(row.week_of_year) || weekOfYear(new Date(row.recorded_date));
    if (!weekly.has(key)) weekly.set(key, { total: new Decimal(0), count: 0 });
    const bucket = weekly.get(key);
    bucket.total = bucket.total.plus(D(row.units_used));
    bucket.count += 1;
  });

  const weekAverages = [...weekly.entries()].map(([week, bucket]) => ({
    week,
    avg: bucket.count ? bucket.total.div(bucket.count) : new Decimal(0),
  }));
  const annualAverage = weekAverages.reduce((sum, row) => sum.plus(row.avg), new Decimal(0)).div(weekAverages.length || 1);
  const current = weekAverages.find((row) => row.week === currentWeekOfYear());
  if (!current || annualAverage.lte(0)) {
    return {
      seasonal_multiplier: 1,
      seasonal_adjustment_pct: 0,
      confidence: 'insufficient_week_data',
      weeks_analyzed: weekAverages.length,
    };
  }

  const multiplier = Decimal.max(new Decimal('0.5'), Decimal.min(new Decimal('2.0'), current.avg.div(annualAverage)));
  return {
    seasonal_multiplier: n(multiplier),
    seasonal_adjustment_pct: n(multiplier.minus(1).times(100), 2),
    confidence: 'normal',
    weeks_analyzed: weekAverages.length,
  };
}

function itemMatchesProduct(item, product) {
  const productId = String(product.id || '').trim();
  const itemNumber = String(product.item_number || '').trim().toLowerCase();
  const name = String(productName(product)).trim().toLowerCase();
  return (
    (item.product_id && String(item.product_id) === productId)
    || (item.productId && String(item.productId) === productId)
    || (item.product_item_number && String(item.product_item_number).toLowerCase() === itemNumber)
    || (item.item_number && String(item.item_number).toLowerCase() === itemNumber)
    || (item.sku && String(item.sku).toLowerCase() === itemNumber)
    || (name && String(item.name || item.description || '').trim().toLowerCase() === name)
  );
}

function quantityFromOrderItem(item) {
  return D(
    item.actual_weight
    ?? item.requested_weight
    ?? item.estimated_weight
    ?? item.ordered_quantity
    ?? item.requested_qty
    ?? item.quantity
    ?? item.qty
    ?? 0
  );
}

async function calculateUpcomingDemand(productId, daysAhead = 14) {
  const product = await fetchProduct(productId);
  const endDate = addDaysIso(daysAhead);
  const { data, error } = await supabase
    .from('orders')
    .select('id,order_number,status,date,created_at,items')
    .in('status', ['pending', 'confirmed', 'in_process', 'processed'])
    .limit(5000);
  if (error) throw new Error(error.message);

  let demand = new Decimal(0);
  let orderCount = 0;
  for (const order of data || []) {
    const orderDate = String(order.date || order.created_at || '').slice(0, 10);
    if (orderDate && orderDate > endDate) continue;
    let matchedOrder = false;
    for (const item of Array.isArray(order.items) ? order.items : []) {
      if (!itemMatchesProduct(item, product)) continue;
      demand = demand.plus(quantityFromOrderItem(item));
      matchedOrder = true;
    }
    if (matchedOrder) orderCount += 1;
  }
  return {
    product_id: productId,
    days_ahead: daysAhead,
    upcoming_demand: n(demand),
    order_count: orderCount,
  };
}

async function calculateReorderPoint(productId) {
  const product = await fetchProduct(productId);
  const usage = await calculateAvgDailyUsage(productId);
  const seasonality = await detectSeasonality(productId);
  const avgDailyUsage = D(usage.selected_average).times(D(seasonality.seasonal_multiplier, 1));
  const leadTimeDays = Math.max(1, Number(product.lead_time_days || 1));
  const safetyStock = D(product.safety_stock);
  const reorderPoint = avgDailyUsage.times(leadTimeDays).plus(safetyStock);

  return {
    product,
    reorder_point: n(reorderPoint),
    avg_daily_usage: n(avgDailyUsage),
    base_avg_daily_usage: usage.selected_average,
    safety_stock: n(safetyStock),
    lead_time_days: leadTimeDays,
    usage,
    seasonality,
  };
}

function roundUpToMoq(quantity, moq) {
  const qty = D(quantity);
  const minOrder = Decimal.max(D(moq), new Decimal(1));
  if (qty.lte(0)) return new Decimal(0);
  return qty.div(minOrder).ceil().times(minOrder);
}

async function calculateSuggestedQuantity(productId) {
  const reorder = await calculateReorderPoint(productId);
  const product = reorder.product;
  const upcoming = await calculateUpcomingDemand(productId);
  const currentStock = D(product.on_hand_qty);
  const avgDailyUsage = D(reorder.avg_daily_usage);
  const targetStock = avgDailyUsage.times(reorder.lead_time_days + REVIEW_PERIOD_DAYS);
  const rawSuggested = targetStock
    .plus(D(reorder.safety_stock))
    .minus(currentStock)
    .plus(D(upcoming.upcoming_demand));
  const roundedSuggested = roundUpToMoq(Decimal.max(rawSuggested, new Decimal(0)), product.min_order_quantity);
  const maxStockLevel = D(product.max_stock_level);
  const maxAllowed = maxStockLevel.gt(0) ? Decimal.max(maxStockLevel.minus(currentStock), new Decimal(0)) : null;
  const finalQty = maxAllowed ? Decimal.min(roundedSuggested, maxAllowed) : roundedSuggested;
  const daysRemaining = avgDailyUsage.gt(0) ? currentStock.div(avgDailyUsage) : null;

  return {
    product,
    suggested_quantity: n(finalQty),
    suggested_unit: productUnit(product),
    current_stock: n(currentStock),
    reorder_point: reorder.reorder_point,
    safety_stock: reorder.safety_stock,
    avg_daily_usage: reorder.avg_daily_usage,
    lead_time_days: reorder.lead_time_days,
    days_of_stock_remaining: daysRemaining ? n(daysRemaining, 2) : null,
    upcoming_order_demand: upcoming.upcoming_demand,
    upcoming_order_count: upcoming.order_count,
    seasonal_adjustment_pct: reorder.seasonality.seasonal_adjustment_pct,
    target_stock: n(targetStock),
    raw_suggested_quantity: n(rawSuggested),
    rounded_to_moq_quantity: n(roundedSuggested),
    min_order_quantity: n(product.min_order_quantity || 1),
    max_stock_level: n(maxStockLevel),
    max_allowed_quantity: maxAllowed ? n(maxAllowed) : null,
    usage: reorder.usage,
    seasonality: reorder.seasonality,
    review_period_days: REVIEW_PERIOD_DAYS,
  };
}

async function calculateUrgency(productId, currentStock = null) {
  const product = await fetchProduct(productId);
  const usage = await calculateAvgDailyUsage(productId);
  const avgDailyUsage = D(usage.selected_average);
  const leadTimeDays = Math.max(1, Number(product.lead_time_days || 1));
  const stock = currentStock === null ? D(product.on_hand_qty) : D(currentStock);
  const daysRemaining = avgDailyUsage.gt(0) ? stock.div(avgDailyUsage) : null;
  const upcoming = await calculateUpcomingDemand(productId);
  const projectedStock = stock.minus(D(upcoming.upcoming_demand));
  const upcomingCausesStockout = D(upcoming.upcoming_demand).gt(0) && projectedStock.lte(0);

  let urgency = 'normal';
  if (daysRemaining && daysRemaining.lte(leadTimeDays)) urgency = 'critical';
  else if (daysRemaining && daysRemaining.lte(new Decimal(leadTimeDays).times('1.5'))) urgency = 'urgent';
  else if (upcomingCausesStockout) urgency = 'urgent';

  return {
    urgency,
    days_remaining: daysRemaining ? n(daysRemaining, 2) : null,
    upcoming_causes_stockout: upcomingCausesStockout,
    upcoming,
  };
}

function generateSuggestionReason(data) {
  const name = productName(data.product);
  const unit = data.suggested_unit || productUnit(data.product);
  const parts = [
    `${name} is at or below its reorder trigger.`,
    `Current stock is ${n(data.current_stock)} ${unit}; reorder point is ${n(data.reorder_point)} ${unit}.`,
  ];
  if (D(data.avg_daily_usage).gt(0)) {
    parts.push(`Average usage is ${n(data.avg_daily_usage)} ${unit}/day, leaving about ${data.days_of_stock_remaining ?? 'unknown'} days of stock.`);
  } else {
    parts.push('Usage history is limited, so the system is using manual/fallback usage settings.');
  }
  parts.push(`Vendor lead time is ${data.lead_time_days} day${data.lead_time_days === 1 ? '' : 's'}.`);
  if (D(data.upcoming_order_demand).gt(0)) {
    parts.push(`${data.upcoming_order_count || 0} upcoming customer order${data.upcoming_order_count === 1 ? '' : 's'} require ${n(data.upcoming_order_demand)} additional ${unit}.`);
  }
  if (D(data.seasonal_adjustment_pct).abs().gte('1')) {
    parts.push(`Seasonality adjusted demand by ${n(data.seasonal_adjustment_pct, 2)}%.`);
  }
  parts.push(`Suggesting ${n(data.suggested_quantity)} ${unit}, rounded to vendor MOQ of ${n(data.min_order_quantity || 1)} ${unit}.`);
  return parts.join(' ');
}

async function resolveVendorForProduct(product) {
  if (product.preferred_vendor_id) return product.preferred_vendor_id;
  if (product.vendor_id) return product.vendor_id;
  const itemNumber = String(product.item_number || '').trim();
  if (!itemNumber) return null;
  const { data } = await supabase
    .from('vendors')
    .select('id,catalog_item_numbers,name')
    .contains('catalog_item_numbers', [itemNumber])
    .limit(1);
  return data?.[0]?.id || null;
}

async function pendingSuggestionForProduct(productId) {
  const { data, error } = await supabase
    .from('reorder_suggestions')
    .select('*')
    .eq('product_id', productId)
    .eq('status', 'pending')
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

function suggestionChanged(existing, next) {
  if (!existing) return true;
  const oldQty = D(existing.suggested_quantity);
  const nextQty = D(next.suggested_quantity);
  const oldStock = D(existing.current_stock);
  const nextStock = D(next.current_stock);
  const qtyDelta = oldQty.eq(0) ? nextQty.abs() : nextQty.minus(oldQty).abs().div(oldQty.abs());
  const stockDelta = oldStock.eq(0) ? nextStock.abs() : nextStock.minus(oldStock).abs().div(oldStock.abs());
  return qtyDelta.gte(USAGE_CHANGE_THRESHOLD) || stockDelta.gte(USAGE_CHANGE_THRESHOLD) || existing.urgency !== next.urgency;
}

async function buildSuggestionPayload(product, options = {}) {
  const calc = await calculateSuggestedQuantity(product.id);
  const urgency = await calculateUrgency(product.id, calc.current_stock);
  const reasonData = { ...calc, urgency: urgency.urgency, anomaly: options.anomaly || null };
  let reason = options.anomaly
    ? `Unusual demand spike detected for ${productName(product)}. Verify and consider emergency reorder. ${generateSuggestionReason(reasonData)}`
    : generateSuggestionReason(reasonData);
  try {
    reason = await enhanceReorderReason(reasonData, reason);
  } catch (error) {
    logger.warn({ err: error, productId: product.id }, 'Reorder reason AI enhancement skipped');
  }
  let aiConfidenceScore = null;
  try {
    aiConfidenceScore = await scoreReorderConfidence({
      product_name: productName(product),
      avg_daily_usage: calc.avg_daily_usage,
      usage_trend: calc.usage.trend,
      seasonal_adjustment: calc.seasonal_adjustment_pct,
      upcoming_demand: calc.upcoming_order_demand,
      days_of_history_available: calc.usage.days_of_history_available,
      lead_time_days: calc.lead_time_days,
    });
  } catch (error) {
    logger.warn({ err: error, productId: product.id }, 'Reorder confidence AI scoring skipped');
  }

  return {
    product_id: product.id,
    vendor_id: await resolveVendorForProduct(product),
    suggested_quantity: s(calc.suggested_quantity),
    suggested_unit: calc.suggested_unit,
    current_stock: s(calc.current_stock),
    reorder_point: s(calc.reorder_point),
    safety_stock: s(calc.safety_stock),
    avg_daily_usage: s(calc.avg_daily_usage),
    lead_time_days: calc.lead_time_days,
    days_of_stock_remaining: calc.days_of_stock_remaining,
    urgency: options.forceUrgency || urgency.urgency,
    reason,
    upcoming_order_demand: s(calc.upcoming_order_demand),
    seasonal_adjustment_pct: n(calc.seasonal_adjustment_pct, 2),
    ai_confidence_score: aiConfidenceScore === null ? null : n(aiConfidenceScore, 3),
    calculation_breakdown: {
      ...calc,
      urgency,
      anomaly: options.anomaly || null,
      low_confidence_warning: calc.usage.days_of_history_available < 7
        ? `Low confidence - only ${calc.usage.days_of_history_available} days of history available`
        : null,
    },
    ...buildScopeFields({}, {
      company_id: product.company_id || undefined,
      location_id: product.location_id || undefined,
    }),
  };
}

async function updateProductMetrics(productId, calc) {
  const payload = {
    reorder_point: s(calc.reorder_point),
    avg_daily_usage: s(calc.avg_daily_usage),
    usage_trend: calc.usage?.trend || 'stable',
    last_reorder_calc_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('products').update(payload).eq('id', productId);
  if (error) throw new Error(error.message);
}

async function detectDemandSpike(product) {
  const rows = await fetchUsage(product.id, daysAgoIso(31));
  if (rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  if (latest.recorded_date !== todayIso()) return null;
  const prior = rows.slice(0, -1);
  const avg = prior.reduce((sum, row) => sum.plus(D(row.units_used)), new Decimal(0)).div(prior.length || 1);
  const latestUsage = D(latest.units_used);
  if (avg.gt(0) && latestUsage.gt(avg.times(3))) {
    return {
      recorded_date: latest.recorded_date,
      units_used: n(latestUsage),
      thirty_day_average_before_spike: n(avg),
      spike_pct: n(latestUsage.minus(avg).div(avg).times(100), 2),
    };
  }
  return null;
}

async function runReorderCheck(options = {}) {
  const { productIds = null, context = null } = options;
  const startedAt = Date.now();
  let query = supabase
    .from('products')
    .select('*')
    .eq('reorder_enabled', true);
  if (Array.isArray(productIds) && productIds.length) query = query.in('id', productIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const products = filterRowsByContext(data || [], context);
  let newSuggestions = 0;
  let updatedSuggestions = 0;
  let skipped = 0;
  const errors = [];

  for (const product of products) {
    try {
      const reorder = await calculateReorderPoint(product.id);
      await updateProductMetrics(product.id, reorder);
      const currentStock = D(product.on_hand_qty);
      const reorderNeeded = currentStock.lte(D(reorder.reorder_point));
      const upcoming = await calculateUpcomingDemand(product.id);
      const projectedStock = currentStock.minus(D(upcoming.upcoming_demand));
      const upcomingWouldStockout = D(upcoming.upcoming_demand).gt(0) && projectedStock.lte(D(reorder.safety_stock));
      const spike = await detectDemandSpike(product);

      if (!reorderNeeded && !upcomingWouldStockout && !spike) {
        skipped += 1;
        continue;
      }

      const payload = await buildSuggestionPayload(product, {
        anomaly: spike,
        forceUrgency: spike ? 'critical' : undefined,
      });
      if (upcomingWouldStockout && payload.urgency === 'normal') payload.urgency = 'scheduled';

      const existing = await pendingSuggestionForProduct(product.id);
      if (!existing) {
        const { error: insertErr } = await supabase
          .from('reorder_suggestions')
          .insert([payload]);
        if (insertErr) throw new Error(insertErr.message);
        newSuggestions += 1;
      } else if (suggestionChanged(existing, payload)) {
        const { error: updateErr } = await supabase
          .from('reorder_suggestions')
          .update(payload)
          .eq('id', existing.id);
        if (updateErr) throw new Error(updateErr.message);
        updatedSuggestions += 1;
      } else {
        skipped += 1;
      }
    } catch (errorForProduct) {
      errors.push({ product_id: product.id, product_name: productName(product), error: errorForProduct.message });
      logger.error({ err: errorForProduct, productId: product.id }, 'Reorder check failed for product');
    }
  }

  const result = {
    new_suggestions: newSuggestions,
    updated_suggestions: updatedSuggestions,
    skipped,
    errors,
    checked_products: products.length,
    duration_ms: Date.now() - startedAt,
  };
  logger.info(result, 'Reorder check completed');
  return result;
}

async function recalcUsageForProduct(product) {
  const since = daysAgoIso(30);
  const { data, error } = await supabase
    .from('inventory_stock_history')
    .select('*')
    .eq('item_number', product.item_number)
    .lt('change_qty', 0)
    .gte('created_at', `${since}T00:00:00.000Z`);
  if (error) throw new Error(error.message);

  const byDay = new Map();
  for (const row of data || []) {
    const date = String(row.created_at || '').slice(0, 10);
    if (!date) continue;
    const next = byDay.get(date) || { units: new Decimal(0), orders: new Set() };
    next.units = next.units.plus(D(row.change_qty).abs());
    if (row.order_id) next.orders.add(row.order_id);
    byDay.set(date, next);
  }

  for (const [recordedDate, bucket] of byDay.entries()) {
    const date = new Date(`${recordedDate}T00:00:00.000Z`);
    const payload = {
      product_id: product.id,
      recorded_date: recordedDate,
      units_used: s(bucket.units),
      order_count: bucket.orders.size,
      week_of_year: weekOfYear(date),
      month_of_year: date.getUTCMonth() + 1,
      is_holiday_week: false,
      ...buildScopeFields({}, {
        company_id: product.company_id || undefined,
        location_id: product.location_id || undefined,
      }),
    };
    const existing = await supabase
      .from('product_usage_history')
      .select('id')
      .eq('product_id', product.id)
      .eq('recorded_date', recordedDate)
      .limit(1);
    const existingId = existing.data?.[0]?.id || null;
    const write = existingId
      ? await supabase.from('product_usage_history').update(payload).eq('id', existingId)
      : await supabase.from('product_usage_history').insert([payload]);
    if (write.error) throw new Error(write.error.message);
  }

  const usage = await calculateAvgDailyUsage(product.id);
  await supabase
    .from('products')
    .update({
      avg_daily_usage: s(usage.selected_average),
      usage_trend: usage.trend,
      last_reorder_calc_at: new Date().toISOString(),
    })
    .eq('id', product.id);
  return usage;
}

async function recalcAllUsage(context = null) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('reorder_enabled', true);
  if (error) throw new Error(error.message);
  const products = filterRowsByContext(data || [], context);
  let updated = 0;
  const errors = [];
  for (const product of products) {
    try {
      await recalcUsageForProduct(product);
      updated += 1;
    } catch (err) {
      errors.push({ product_id: product.id, error: err.message });
      logger.error({ err, productId: product.id }, 'Usage recalculation failed');
    }
  }
  return { updated_products: updated, errors };
}

async function updateLeadTimesFromPurchaseOrder(po) {
  if (!po?.created_at || !po?.received_at || !Array.isArray(po.items)) return { updated_products: 0 };
  const elapsedMs = new Date(po.received_at).getTime() - new Date(po.created_at).getTime();
  if (elapsedMs < 3_600_000) {
    console.warn('[reorder] skipping lead time update - elapsed time < 1 hour, likely a same-request race condition');
    return { updated_products: 0 };
  }
  const actualDays = Math.max(1, Math.round((new Date(po.received_at).getTime() - new Date(po.created_at).getTime()) / DAY_MS));
  let updated = 0;
  for (const item of po.items) {
    const itemNumber = String(item.item_number || item.product_item_number || '').trim();
    if (!itemNumber) continue;
    const { data: product } = await supabase
      .from('products')
      .select('id,lead_time_days')
      .eq('item_number', itemNumber)
      .limit(1)
      .single();
    if (!product?.id) continue;
    const rolling = Math.max(1, Math.round((Number(product.lead_time_days || actualDays) * 0.7) + (actualDays * 0.3)));
    await supabase
      .from('products')
      .update({ lead_time_days: rolling, last_reorder_calc_at: new Date().toISOString() })
      .eq('id', product.id);
    updated += 1;
  }
  return { updated_products: updated, actual_lead_time_days: actualDays };
}

module.exports = {
  calculateAvgDailyUsage,
  detectSeasonality,
  calculateUpcomingDemand,
  calculateReorderPoint,
  calculateSuggestedQuantity,
  calculateUrgency,
  generateSuggestionReason,
  runReorderCheck,
  recalcAllUsage,
  recalcUsageForProduct,
  updateLeadTimesFromPurchaseOrder,
  D,
  n,
  s,
};
