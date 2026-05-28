const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const logger = require('../services/logger');
const {
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');

const router = express.Router();

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((asNumber(value) + Number.EPSILON) * factor) / factor;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function parseOrderItemToken(value) {
  const token = normalizeText(value);
  const match = token.match(/^([^:]+):(\d+)$/);
  if (!match) return null;
  return { orderId: match[1], itemIndex: Number(match[2]) };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeText(value));
}

function itemName(item, fallback = 'item') {
  return item?.name || item?.description || item?.item_number || fallback;
}

function orderedQuantityForItem(item) {
  return asNumber(item?.ordered_quantity ?? item?.requested_qty ?? item?.quantity ?? item?.cases ?? 1, 1);
}

function orderedUnitForItem(item) {
  return normalizeText(item?.ordered_unit || item?.order_unit || item?.case_unit || item?.unit) || 'case';
}

function estimateForItem(item, product, orderedQuantity) {
  const explicit = asNumber(item?.estimated_weight, NaN);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const unitWeight = asNumber(product?.estimated_unit_weight ?? item?.estimated_unit_weight, 0);
  return round(orderedQuantity * unitWeight);
}

function withCalculatedFields(entry) {
  const actualWeight = asNumber(entry.actual_weight, 0);
  const estimatedWeight = asNumber(entry.estimated_weight, 0);
  const pricePerWeightUnit = asNumber(entry.price_per_weight_unit, 0);
  const varianceWeight = round(actualWeight - estimatedWeight);
  const variancePct = estimatedWeight > 0 ? round((varianceWeight / estimatedWeight) * 100, 3) : 0;
  return {
    ...entry,
    variance_weight: varianceWeight,
    variance_pct: variancePct,
    total_price: round(actualWeight * pricePerWeightUnit),
  };
}

async function fetchProduct(item = {}, context = null) {
  const productId = normalizeText(item.product_id);
  if (productId && isUuid(productId)) {
    const byId = await scopeQueryByContext(supabase.from('products').select('*'), context).eq('id', productId).single();
    if (!byId.error && byId.data) return byId.data;
  }

  const itemNumber = normalizeText(item.item_number || item.product_item_number);
  if (itemNumber) {
    const byNumber = await scopeQueryByContext(supabase.from('products').select('*'), context).eq('item_number', itemNumber).limit(1);
    if (!byNumber.error && Array.isArray(byNumber.data) && byNumber.data.length) return byNumber.data[0];
  }

  return null;
}

async function fetchOrder(orderId, context = null) {
  if (!orderId) return null;
  const { data, error } = await scopeQueryByContext(supabase.from('orders').select('*'), context).eq('id', orderId).single();
  if (error || !data) return null;
  return data;
}

async function resolveOrderItem(bodyOrParams, context = null) {
  const explicitOrderId = normalizeText(bodyOrParams.order_id);
  const explicitIndex = bodyOrParams.item_index ?? bodyOrParams.itemIndex;
  if (explicitOrderId && explicitIndex !== undefined) {
    const order = await fetchOrder(explicitOrderId, context);
    const index = Number(explicitIndex);
    const items = Array.isArray(order?.items) ? order.items : [];
    if (!order || !Number.isInteger(index) || index < 0 || index >= items.length) return null;
    return { order, item: items[index], itemIndex: index, orderItemId: normalizeText(bodyOrParams.order_item_id) || `${order.id}:${index}` };
  }

  const parsed = parseOrderItemToken(bodyOrParams.order_item_id);
  if (parsed) return resolveOrderItem({ order_id: parsed.orderId, item_index: parsed.itemIndex, order_item_id: bodyOrParams.order_item_id }, context);

  const orderItemId = normalizeText(bodyOrParams.order_item_id);
  if (!orderItemId) return null;

  const { data: orderItem } = await scopeQueryByContext(supabase.from('order_items').select('*'), context).eq('id', orderItemId).single();
  if (!orderItem) return null;

  const order = await fetchOrder(orderItem.order_id, context);
  return {
    order,
    orderItemRow: orderItem,
    orderItemId,
    itemIndex: Number.isInteger(Number(orderItem.item_index)) ? Number(orderItem.item_index) : null,
    item: {
      ...orderItem,
      name: orderItem.name || orderItem.description,
      quantity: orderItem.ordered_quantity,
      unit: orderItem.ordered_unit,
      estimated_weight: orderItem.estimated_weight,
      price_per_lb: orderItem.price_per_weight_unit || orderItem.price_per_lb || orderItem.unit_price,
      is_catch_weight: orderItem.is_catch_weight,
    },
  };
}

async function updateOrderItemStatus(resolved, entry, status, context = null) {
  const updateFields = {
    catch_weight_entry_id: entry.id,
    weight_status: status,
    actual_weight: entry.actual_weight,
    weighed_at: entry.weighed_at,
    approved_at: entry.approved_at || null,
    approved_by: entry.approved_by || null,
  };

  if (resolved.orderItemRow?.id) {
    await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase.from('order_items').update(candidate), context).eq('id', resolved.orderItemRow.id).select().single(),
      updateFields
    );
  }

  if (resolved.order?.id && Number.isInteger(resolved.itemIndex)) {
    const items = Array.isArray(resolved.order.items) ? resolved.order.items : [];
    const nextItems = items.map((item, idx) => {
      if (idx !== resolved.itemIndex) return item;
      return {
        ...item,
        is_catch_weight: true,
        catch_weight_entry_id: entry.id,
        weight_status: status,
        actual_weight: entry.actual_weight,
        weight_unit: entry.weight_unit,
        price_per_lb: entry.price_per_weight_unit,
        total: round(asNumber(entry.actual_weight) * asNumber(entry.price_per_weight_unit), 2),
        weighed_at: entry.weighed_at,
        catch_weight_approved_at: entry.approved_at || item.catch_weight_approved_at || null,
        catch_weight_approved_by: entry.approved_by || item.catch_weight_approved_by || null,
      };
    });
    await scopeQueryByContext(supabase.from('orders').update({ items: nextItems }), context).eq('id', resolved.order.id);
  }
}

async function createCatchWeightEntry(input, req) {
  const resolved = await resolveOrderItem(input, req.context);
  if (!resolved?.item) {
    const error = new Error('order_item_id was not found');
    error.status = 404;
    throw error;
  }
  if (resolved.order && !rowMatchesContext(resolved.order, req.context)) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  const product = await fetchProduct(resolved.item, req.context);
  const orderedQuantity = asNumber(input.ordered_quantity ?? resolved.orderItemRow?.ordered_quantity ?? orderedQuantityForItem(resolved.item), 0);
  const actualWeight = asNumber(input.actual_weight, NaN);
  const pricePerWeightUnit = asNumber(input.price_per_weight_unit ?? resolved.item.price_per_weight_unit ?? resolved.item.price_per_lb ?? resolved.item.unit_price, NaN);
  if (!Number.isFinite(actualWeight) || actualWeight <= 0) {
    const error = new Error('actual_weight must be a positive number');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(pricePerWeightUnit) || pricePerWeightUnit < 0) {
    const error = new Error('price_per_weight_unit must be a non-negative number');
    error.status = 400;
    throw error;
  }

  const estimatedWeight = estimateForItem(resolved.item, product, orderedQuantity);
  const baseEntry = withCalculatedFields({
    order_item_id: isUuid(resolved.orderItemId) ? resolved.orderItemId : null,
    order_item_ref: resolved.orderItemId,
    order_id: resolved.order?.id || resolved.orderItemRow?.order_id || input.order_id || null,
    item_index: Number.isInteger(resolved.itemIndex) ? resolved.itemIndex : null,
    invoice_id: input.invoice_id || null,
    lot_id: isUuid(input.lot_id || resolved.item.lot_id) ? (input.lot_id || resolved.item.lot_id) : null,
    product_id: product?.id || (isUuid(resolved.item.product_id) ? resolved.item.product_id : null),
    product_item_number: product?.item_number || resolved.item.item_number || null,
    ordered_quantity: orderedQuantity,
    ordered_unit: input.ordered_unit || orderedUnitForItem(resolved.item),
    actual_weight: round(actualWeight),
    weight_unit: normalizeText(input.weight_unit || product?.catch_weight_unit || resolved.item.weight_unit) || 'lb',
    price_per_weight_unit: round(pricePerWeightUnit),
    estimated_weight: round(estimatedWeight),
    weighed_by: input.weighed_by || req.user?.id || null,
    weighed_at: input.weighed_at || new Date().toISOString(),
    scale_id: input.scale_id || null,
    notes: input.notes || null,
  });

  const tolerancePct = asNumber(product?.weight_tolerance_pct ?? resolved.item.weight_tolerance_pct, 10);
  const status = Math.abs(baseEntry.variance_pct) > tolerancePct ? 'variance_flagged' : 'weighed';

  const insertPayload = { ...baseEntry };
  insertPayload.weight_status = status;
  delete insertPayload.variance_weight;
  delete insertPayload.variance_pct;
  delete insertPayload.total_price;

  const existing = await scopeQueryByContext(supabase
    .from('catch_weight_entries')
    .select('*'), req.context)
    .eq(isUuid(resolved.orderItemId) ? 'order_item_id' : 'order_item_ref', resolved.orderItemId)
    .limit(1);
  let writeResult;
  if (!existing.error && Array.isArray(existing.data) && existing.data[0]?.id) {
    writeResult = await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase.from('catch_weight_entries').update(candidate), req.context).eq('id', existing.data[0].id).select().single(),
      insertPayload
    );
  } else {
    writeResult = await insertRecordWithOptionalScope(supabase, 'catch_weight_entries', insertPayload, req.context);
  }
  if (writeResult.error) throw writeResult.error;

  const entry = withCalculatedFields({ ...baseEntry, ...(writeResult.data || {}) });
  await updateOrderItemStatus(resolved, entry, status, req.context);

  if (status === 'variance_flagged') {
    logger.warn({
      order_id: entry.order_id,
      order_item_id: entry.order_item_id,
      product_id: entry.product_id,
      actual_weight: entry.actual_weight,
      estimated_weight: entry.estimated_weight,
      variance_pct: entry.variance_pct,
      tolerance_pct: tolerancePct,
    }, 'Catch weight variance exceeded tolerance');
  }

  return { ...entry, weight_status: status, product };
}

router.post('/entry', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const entry = await createCatchWeightEntry(req.body || {}, req);
    res.json(entry);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to record catch weight' });
  }
});

router.get('/entry/:order_item_id', authenticateToken, async (req, res) => {
  const orderItemId = req.params.order_item_id;
  const { data, error } = await scopeQueryByContext(supabase
    .from('catch_weight_entries')
    .select('*'), req.context)
    .eq(isUuid(orderItemId) ? 'order_item_id' : 'order_item_ref', orderItemId)
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const entry = data?.[0];
  if (!entry) return res.status(404).json({ error: 'Catch weight entry not found' });

  const order = await fetchOrder(entry.order_id, req.context);
  if (order && !rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const product = await fetchProduct(entry, req.context);
  const item = Number.isInteger(Number(entry.item_index)) ? order?.items?.[Number(entry.item_index)] : null;
  res.json({ ...withCalculatedFields(entry), product, weight_status: item?.weight_status || entry.weight_status || null });
});

router.patch('/entry/:id/approve', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data: entry, error: fetchError } = await scopeQueryByContext(supabase.from('catch_weight_entries').select('*'), req.context).eq('id', req.params.id).single();
  if (fetchError || !entry) return res.status(404).json({ error: 'Catch weight entry not found' });
  const order = await fetchOrder(entry.order_id, req.context);
  if (order && !rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const approvedAt = new Date().toISOString();
  const updateResult = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(supabase.from('catch_weight_entries').update(candidate), req.context).eq('id', req.params.id).select().single(),
    { approved_by: req.user?.id || null, approved_at: approvedAt, weight_status: 'approved', updated_at: approvedAt }
  );
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });

  await updateOrderItemStatus({
    order,
    itemIndex: Number.isInteger(Number(entry.item_index)) ? Number(entry.item_index) : null,
    orderItemRow: entry.order_item_id ? { id: entry.order_item_id } : null,
  }, { ...entry, ...(updateResult.data || {}) }, 'approved', req.context);

  res.json({ ...withCalculatedFields({ ...entry, ...(updateResult.data || {}) }), weight_status: 'approved' });
});

router.get('/order/:order_id', authenticateToken, async (req, res) => {
  const order = await fetchOrder(req.params.order_id, req.context);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await scopeQueryByContext(supabase.from('catch_weight_entries').select('*'), req.context).eq('order_id', req.params.order_id);
  if (error) return res.status(500).json({ error: error.message });
  const entries = (data || []).map(withCalculatedFields);
  const summary = entries.reduce((acc, entry) => {
    acc.total_ordered_units += asNumber(entry.ordered_quantity);
    acc.total_actual_weight += asNumber(entry.actual_weight);
    acc.total_estimated_weight += asNumber(entry.estimated_weight);
    acc.total_price += asNumber(entry.total_price);
    return acc;
  }, {
    total_ordered_units: 0,
    total_actual_weight: 0,
    total_estimated_weight: 0,
    total_price: 0,
  });
  summary.total_variance_lbs = round(summary.total_actual_weight - summary.total_estimated_weight);
  summary.total_variance_pct = summary.total_estimated_weight > 0 ? round((summary.total_variance_lbs / summary.total_estimated_weight) * 100, 3) : 0;
  summary.has_variance_flagged = (order.items || []).some((item) => item.weight_status === 'variance_flagged');
  res.json({ order_id: req.params.order_id, entries, summary });
});

router.get('/product/:product_id/history', authenticateToken, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await scopeQueryByContext(supabase
    .from('catch_weight_entries')
    .select('*'), req.context)
    .eq('product_id', req.params.product_id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  const rows = filterRowsByContext((data || []).map(withCalculatedFields), req.context);
  const totals = rows.reduce((acc, row) => {
    acc.actual += asNumber(row.actual_weight);
    acc.units += asNumber(row.ordered_quantity);
    return acc;
  }, { actual: 0, units: 0 });
  res.json({
    product_id: req.params.product_id,
    average_actual_weight_per_unit: totals.units > 0 ? round(totals.actual / totals.units) : 0,
    records: rows,
    limit,
  });
});

router.post('/bulk-entry', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : Array.isArray(req.body) ? req.body : [];
  if (!entries.length) return res.status(400).json({ error: 'entries must be a non-empty array' });
  const results = [];
  for (let index = 0; index < entries.length; index += 1) {
    try {
      const entry = await createCatchWeightEntry(entries[index], req);
      results.push({ index, ok: true, entry });
    } catch (error) {
      results.push({ index, ok: false, error: error.message || 'Failed to record catch weight' });
    }
  }
  res.json({
    success_count: results.filter((result) => result.ok).length,
    failure_count: results.filter((result) => !result.ok).length,
    results,
  });
});

router.get('/variance-report', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  let query = scopeQueryByContext(supabase.from('catch_weight_entries').select('*'), req.context);
  if (req.query.product_id) query = query.eq('product_id', req.query.product_id);
  if (req.query.driver || req.query.weighed_by) query = query.eq('weighed_by', req.query.driver || req.query.weighed_by);
  if (req.query.order_id) query = query.eq('order_id', req.query.order_id);
  if (req.query.start_date) query = query.gte('created_at', req.query.start_date);
  if (req.query.end_date) query = query.lte('created_at', req.query.end_date);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const flagged = filterRowsByContext((data || []).map(withCalculatedFields), req.context)
    .filter((entry) => !entry.approved_at && entry.weight_status === 'variance_flagged')
    .sort((a, b) => Math.abs(asNumber(b.variance_pct)) - Math.abs(asNumber(a.variance_pct)));
  res.json({ entries: flagged, count: flagged.length });
});

module.exports = router;
module.exports.createCatchWeightEntry = createCatchWeightEntry;
module.exports.withCalculatedFields = withCalculatedFields;
