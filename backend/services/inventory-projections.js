'use strict';

const { supabase } = require('./supabase');
const { scopeQueryByContext } = require('./operating-context');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lineProductMatches(line, product) {
  if (!line || !product) return false;
  return String(line.product_id || line.productId || '') === String(product.id || '')
    || String(line.item_number || line.itemNumber || line.sku || '') === String(product.item_number || '');
}

function lineQty(line) {
  return toNumber(
    line.qty
      ?? line.quantity
      ?? line.ordered_qty
      ?? line.qty_ordered
      ?? line.quantity_ordered
      ?? line.open_qty,
    0,
  );
}

function rowsForLines(rows, product, dateFields, lineFields) {
  const events = [];
  for (const row of rows || []) {
    const date = isoDate(dateFields.map((key) => row[key]).find(Boolean));
    if (!date) continue;
    const sourceLines = lineFields
      .flatMap((key) => Array.isArray(row[key]) ? row[key] : [])
      .filter(Boolean);
    for (const line of sourceLines) {
      if (!lineProductMatches(line, product)) continue;
      const qty = lineQty(line);
      if (qty > 0) events.push({ date, qty });
    }
  }
  return events;
}

async function fetchProduct(productId, supabaseClient, context) {
  const id = String(productId || '').trim();
  if (!id) throw new Error('productId is required');
  let byId = supabaseClient.from('products').select('*').eq('id', id).limit(1);
  byId = scopeQueryByContext(byId, context);
  const byIdResult = await byId;
  if (byIdResult.error) throw byIdResult.error;
  if (byIdResult.data?.[0]) return byIdResult.data[0];

  let byItem = supabaseClient.from('products').select('*').eq('item_number', id).limit(1);
  byItem = scopeQueryByContext(byItem, context);
  const byItemResult = await byItem;
  if (byItemResult.error) throw byItemResult.error;
  if (byItemResult.data?.[0]) return byItemResult.data[0];

  const error = new Error('Product not found');
  error.status = 404;
  throw error;
}

async function buildInventoryProjection({
  productId,
  days = 30,
  today = new Date().toISOString().slice(0, 10),
  supabaseClient = supabase,
  context = null,
} = {}) {
  const windowDays = Math.max(1, Math.min(Number(days) || 30, 90));
  const start = isoDate(today) || new Date().toISOString().slice(0, 10);
  const end = addDays(start, windowDays - 1);
  const product = await fetchProduct(productId, supabaseClient, context);

  let lotQuery = supabaseClient
    .from('inventory_lots')
    .select('*')
    .eq('product_id', product.id)
    .eq('status', 'active');
  lotQuery = scopeQueryByContext(lotQuery, context);
  const lotResult = await lotQuery;
  if (lotResult.error) throw lotResult.error;
  const lotOnHand = (lotResult.data || []).reduce((sum, lot) => sum + Math.max(0, toNumber(lot.qty_on_hand, 0)), 0);
  const currentOnHand = toNumber(product.on_hand_qty ?? product.on_hand_quantity, 0) + lotOnHand;

  let poQuery = supabaseClient
    .from('purchase_orders')
    .select('*')
    .in('status', ['open', 'partial_received', 'backordered']);
  poQuery = scopeQueryByContext(poQuery, context);
  const poResult = await poQuery;
  if (poResult.error) throw poResult.error;

  let orderQuery = supabaseClient
    .from('orders')
    .select('*')
    .in('status', ['open', 'pending', 'submitted', 'confirmed', 'scheduled']);
  orderQuery = scopeQueryByContext(orderQuery, context);
  const orderResult = await orderQuery;
  if (orderResult.error) throw orderResult.error;

  const receipts = rowsForLines(
    poResult.data,
    product,
    ['expected_date', 'expectedDate', 'scheduled_receipt_date', 'receipt_date', 'delivery_date'],
    ['items', 'lines'],
  );
  const allocations = rowsForLines(
    orderResult.data,
    product,
    ['delivery_date', 'scheduled_date', 'ship_date', 'created_at'],
    ['items', 'lines', 'order_items'],
  );

  let projected = currentOnHand;
  const rows = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = addDays(start, offset);
    projected += receipts
      .filter((event) => event.date === date)
      .reduce((sum, event) => sum + event.qty, 0);
    projected -= allocations
      .filter((event) => event.date === date)
      .reduce((sum, event) => sum + event.qty, 0);
    rows.push({ date, projected_qty: Number(projected.toFixed(4)) });
    if (date >= end) break;
  }
  return rows;
}

module.exports = {
  buildInventoryProjection,
};
