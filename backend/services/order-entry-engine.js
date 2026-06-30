'use strict';

const pricingEngine = require('./pricing-engine');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('./operating-context');

function defaultDb() {
  return require('./supabase').supabase;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function activeOnDate(row, onDate, startField = 'effective_date', endField = 'expiry_date') {
  const date = String(onDate || todayIsoDate()).slice(0, 10);
  const start = row?.[startField] ? String(row[startField]).slice(0, 10) : null;
  const end = row?.[endField] ? String(row[endField]).slice(0, 10) : null;
  if (start && start > date) return false;
  if (end && end < date) return false;
  return true;
}

function scoped(rows, context) {
  return filterRowsByContext(rows || [], context);
}

function lineQuantity(line) {
  return toNumber(line?.quantity ?? line?.qty ?? line?.requested_qty ?? line?.requestedQty, 0);
}

function lineUnitPrice(line) {
  return toNumber(line?.unit_price ?? line?.unitPrice ?? line?.price ?? line?.price_per_lb, 0);
}

function lineProductId(line) {
  return normalizeText(line?.product_id || line?.productId);
}

async function loadProduct(db, { productId, barcode, context }) {
  const id = normalizeText(productId);
  if (id && !id.startsWith('item:')) {
    const { data, error } = await scopeQueryByContext(
      db.from('products').select('*'),
      context,
    )
      .eq('id', id)
      .limit(1);
    if (error) throw error;
    const product = scoped(data, context)[0];
    if (product) return product;
  }

  const normalizedBarcode = normalizeText(barcode || (id.startsWith('item:') ? id.slice(5) : ''));
  if (normalizedBarcode) {
    for (const field of ['barcode', 'item_number']) {
      const { data, error } = await scopeQueryByContext(
        db.from('products').select('*'),
        context,
      )
        .eq(field, normalizedBarcode)
        .limit(1);
      if (error) throw error;
      const product = scoped(data, context)[0];
      if (product) return product;
    }
  }

  return null;
}

async function loadOrder(db, orderId, context) {
  const { data, error } = await scopeQueryByContext(
    db.from('orders').select('*'),
    context,
  )
    .eq('id', orderId)
    .limit(1);
  if (error) throw error;
  return scoped(data, context)[0] || null;
}

async function loadActiveOrderGuideDefault(db, { customerId, productId, context }) {
  const { data: guideRows, error: guideError } = await scopeQueryByContext(
    db.from('order_guides').select('*'),
    context,
  )
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .limit(10);
  if (guideError) throw guideError;
  const guideIds = scoped(guideRows, context).map((guide) => guide.id).filter(Boolean);
  if (!guideIds.length) return null;

  const { data: itemRows, error: itemError } = await scopeQueryByContext(
    db.from('order_guide_items').select('*'),
    context,
  )
    .in('order_guide_id', guideIds)
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .limit(1);
  if (itemError) throw itemError;
  return scoped(itemRows, context)[0] || null;
}

async function findSubstitute(db, { customerId, product, context }) {
  if (toNumber(product?.on_hand_qty ?? product?.on_hand_quantity, 0) > 0) return null;
  const { data, error } = await scopeQueryByContext(
    db.from('customer_substitutions').select('*'),
    context,
  )
    .eq('customer_id', customerId)
    .eq('original_product_id', product.id)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (error) throw error;

  for (const substitution of scoped(data, context)) {
    const substitute = await loadProduct(db, {
      productId: substitution.substitute_product_id,
      context,
    });
    if (substitute && toNumber(substitute.on_hand_qty ?? substitute.on_hand_quantity, 0) > 0) {
      return { substitution, substitute };
    }
  }
  return null;
}

async function loadBottleDeposit(db, { productId, context }) {
  const { data, error } = await scopeQueryByContext(
    db.from('bottle_deposits').select('*'),
    context,
  )
    .eq('product_id', productId)
    .eq('is_active', true)
    .limit(1);
  if (error) throw error;
  return scoped(data, context)[0] || null;
}

async function loadHotMessages(db, { customerId, context, onDate, type = 'order_entry' }) {
  const { data, error } = await scopeQueryByContext(
    db.from('customer_hot_messages').select('*'),
    context,
  )
    .eq('customer_id', customerId)
    .eq('message_type', type);
  if (error) throw error;
  return scoped(data, context)
    .filter((message) => activeOnDate(message, onDate, 'start_date', 'end_date'))
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
}

async function loadInstructions(db, { customerId, productId, context }) {
  const { data, error } = await scopeQueryByContext(
    db.from('customer_item_instructions').select('*'),
    context,
  )
    .eq('customer_id', customerId)
    .eq('product_id', productId)
    .order('instruction_type', { ascending: true });
  if (error) throw error;
  return scoped(data, context);
}

function itemFromProduct(product, { qty, uom, price, instructions = [], messages = [], substitution = null }) {
  const quantity = toNumber(qty, 1) || 1;
  const unitPrice = toNumber(price, 0);
  const catchWeight = product?.is_catch_weight === true;
  return {
    product_id: product.id,
    item_number: product.item_number || null,
    name: product.description || product.name || product.item_number || product.id,
    quantity,
    unit: uom || product.unit || 'each',
    unit_price: unitPrice,
    total: roundMoney(quantity * unitPrice),
    is_catch_weight: catchWeight,
    estimated_weight: catchWeight ? toNumber(product.estimated_unit_weight, 0) * quantity : undefined,
    instructions,
    hot_messages: messages,
    substitution,
  };
}

async function resolveOrderLine(args) {
  const db = args.db || defaultDb();
  const context = args.context;
  const customerId = normalizeText(args.customerId);
  const originalProduct = await loadProduct(db, { productId: args.productId, barcode: args.barcode, context });
  if (!originalProduct) throw new Error('Product not found');

  const guideDefault = await loadActiveOrderGuideDefault(db, {
    customerId,
    productId: originalProduct.id,
    context,
  });
  const requestedQty = args.qty != null ? toNumber(args.qty, 1) : toNumber(guideDefault?.default_qty, 1);
  const requestedUom = normalizeText(args.uom || guideDefault?.default_uom || originalProduct.unit || 'each');
  const substitutionResult = await findSubstitute(db, {
    customerId,
    product: originalProduct,
    context,
  });
  const product = substitutionResult?.substitute || originalProduct;

  const price = await pricingEngine.resolvePrice({
    db,
    customerId,
    productId: product.id,
    qty: requestedQty,
    uom: requestedUom,
    context,
    onDate: args.onDate,
  });
  const [deposit, hotMessages, instructions] = await Promise.all([
    loadBottleDeposit(db, { productId: product.id, context }),
    loadHotMessages(db, { customerId, context, onDate: args.onDate, type: 'order_entry' }),
    loadInstructions(db, { customerId, productId: product.id, context }),
  ]);

  const substitution = substitutionResult ? {
    id: substitutionResult.substitution.id,
    original_product_id: originalProduct.id,
    substitute_product_id: product.id,
    reason: 'original_out_of_stock',
  } : null;

  const resolved = itemFromProduct(product, {
    qty: requestedQty,
    uom: requestedUom,
    price: price.price,
    instructions,
    messages: hotMessages,
    substitution,
  });
  resolved.price = price;
  resolved.deposit_lines = deposit ? [{
    product_id: product.id,
    name: 'Bottle deposit',
    quantity: requestedQty,
    unit: deposit.deposit_uom || requestedUom,
    unit_price: toNumber(deposit.deposit_amount, 0),
    total: roundMoney(requestedQty * toNumber(deposit.deposit_amount, 0)),
    is_deposit: true,
    source_id: deposit.id,
  }] : [];
  resolved.guide_default = guideDefault || null;
  return resolved;
}

async function validateMinimumSell(args) {
  const db = args.db || defaultDb();
  return pricingEngine.enforceMinimumSell({
    db,
    price: args.price,
    productId: args.productId,
    itemNumber: args.itemNumber,
    context: args.context,
  });
}

async function activeFuelRule(db, context, onDate) {
  const { data, error } = await scopeQueryByContext(
    db.from('fuel_surcharge_rules').select('*'),
    context,
  ).order('effective_date', { ascending: false });
  if (error) throw error;
  return scoped(data, context).find((rule) => activeOnDate(rule, onDate)) || null;
}

async function applyFuelSurcharge(args) {
  const db = args.db || defaultDb();
  const order = await loadOrder(db, args.orderId, args.context);
  if (!order) throw new Error('Order not found');
  const rule = await activeFuelRule(db, args.context, args.onDate);
  if (!rule) return { order, surcharge_line: null };

  const items = Array.isArray(order.items) ? [...order.items] : [];
  const baseTotal = items.reduce((sum, item) => sum + (toNumber(item.total, NaN) || lineQuantity(item) * lineUnitPrice(item)), 0);
  if (rule.min_order_value != null && baseTotal < toNumber(rule.min_order_value, 0)) {
    return { order, surcharge_line: null };
  }
  const amount = rule.method === 'flat' ? toNumber(rule.value, 0) : baseTotal * (toNumber(rule.value, 0) / 100);
  const surchargeLine = {
    name: 'Fuel surcharge',
    item_number: 'FUEL',
    quantity: 1,
    unit: 'each',
    unit_price: roundMoney(amount),
    total: roundMoney(amount),
    surcharge_rule_id: rule.id,
  };
  const withoutExisting = items.filter((item) => item.surcharge_rule_id !== rule.id && item.item_number !== 'FUEL');
  const updatedItems = [...withoutExisting, surchargeLine];
  const updatedTotal = roundMoney(baseTotal + surchargeLine.total);
  const { data, error } = await scopeQueryByContext(
    db.from('orders').update({
      items: updatedItems,
      subtotal: updatedTotal,
      total: updatedTotal,
    }),
    args.context,
  )
    .eq('id', order.id)
    .select()
    .single();
  if (error) throw error;
  return { order: data || { ...order, items: updatedItems, total: updatedTotal }, surcharge_line: surchargeLine };
}

async function loadProductsById(db, productIds, context) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await scopeQueryByContext(
    db.from('products').select('*'),
    context,
  ).in('id', ids);
  if (error) throw error;
  return new Map(scoped(data, context).map((product) => [String(product.id), product]));
}

async function processBackorder(args) {
  const db = args.db || defaultDb();
  const order = await loadOrder(db, args.orderId, args.context);
  if (!order) throw new Error('Order not found');
  const items = Array.isArray(order.items) ? order.items : [];
  const productsById = await loadProductsById(db, items.map(lineProductId), args.context);
  const shippable = [];
  const backordered = [];
  for (const item of items) {
    const product = productsById.get(lineProductId(item));
    const available = toNumber(product?.on_hand_qty ?? product?.on_hand_quantity, Infinity);
    if (available < lineQuantity(item)) backordered.push(item);
    else shippable.push(item);
  }
  if (!backordered.length) return { updated_order: order, backorder: null };

  const updateResult = await scopeQueryByContext(
    db.from('orders').update({ items: shippable }),
    args.context,
  )
    .eq('id', order.id)
    .select()
    .single();
  if (updateResult.error) throw updateResult.error;

  const insertResult = await insertRecordWithOptionalScope(db, 'orders', {
    order_number: `${order.order_number || order.id}-BO`,
    customer_id: order.customer_id || null,
    customer_name: order.customer_name,
    customer_email: order.customer_email || null,
    customer_address: order.customer_address || null,
    route_id: order.route_id || null,
    status: 'backorder',
    source: order.source || 'backorder',
    parent_order_id: order.id,
    items: backordered,
    notes: `Backorder split from ${order.order_number || order.id}`,
  }, args.context);
  if (insertResult.error) throw insertResult.error;
  return {
    updated_order: updateResult.data || { ...order, items: shippable },
    backorder: insertResult.data,
  };
}

async function findProductByBarcode(db, barcode, context) {
  const normalized = normalizeText(barcode);
  if (!normalized) return null;
  for (const field of ['barcode', 'item_number']) {
    const { data, error } = await scopeQueryByContext(
      db.from('products').select('*'),
      context,
    )
      .eq(field, normalized)
      .limit(1);
    if (error) throw error;
    const product = scoped(data, context)[0];
    if (product) return product;
  }
  return null;
}

async function applyBarcodeScan(args) {
  const db = args.db || defaultDb();
  const order = await loadOrder(db, args.orderId, args.context);
  if (!order) throw new Error('Order not found');
  const barcode = normalizeText(args.barcode);
  const existingEvent = await scopeQueryByContext(
    db.from('barcode_scan_events').select('*'),
    args.context,
  )
    .eq('order_id', order.id)
    .eq('barcode', barcode)
    .limit(1);
  if (existingEvent.error) throw existingEvent.error;
  if (scoped(existingEvent.data, args.context)[0]) {
    return { action: 'duplicate', order };
  }

  const product = await findProductByBarcode(db, barcode, args.context);
  if (!product) throw new Error('Barcode did not resolve to a product');
  const items = Array.isArray(order.items) ? [...order.items] : [];
  const existingIndex = items.findIndex((item) => lineProductId(item) === String(product.id));
  let action = 'added';
  if (existingIndex >= 0) {
    items[existingIndex] = {
      ...items[existingIndex],
      quantity: lineQuantity(items[existingIndex]) + 1,
    };
    items[existingIndex].total = roundMoney(lineQuantity(items[existingIndex]) * lineUnitPrice(items[existingIndex]));
    action = 'incremented';
  } else {
    const resolved = await resolveOrderLine({
      db,
      customerId: order.customer_id || args.customerId || '',
      productId: product.id,
      qty: 1,
      uom: product.unit || 'each',
      context: args.context,
    });
    items.push(resolved);
  }

  const updateResult = await scopeQueryByContext(
    db.from('orders').update({ items }),
    args.context,
  )
    .eq('id', order.id)
    .select()
    .single();
  if (updateResult.error) throw updateResult.error;
  const eventResult = await insertRecordWithOptionalScope(db, 'barcode_scan_events', {
    order_id: order.id,
    barcode,
    resolved_product_id: product.id,
    scanned_by: args.userId || null,
    scanned_at: new Date().toISOString(),
  }, args.context);
  if (eventResult.error) throw eventResult.error;
  return {
    action,
    order: updateResult.data || { ...order, items },
    event: eventResult.data,
  };
}

module.exports = {
  applyBarcodeScan,
  applyFuelSurcharge,
  processBackorder,
  resolveOrderLine,
  validateMinimumSell,
};
