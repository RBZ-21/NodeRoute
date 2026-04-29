const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabase');

const dataDir = path.join(__dirname, '../data');
const opsFile = path.join(dataDir, 'ops.json');

function defaultOpsData() {
  return {
    uomRules: [],
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', isDefault: true, created_at: new Date().toISOString() }],
    cycleCounts: [],
    returns: [],
    barcodeEvents: [],
    ediJobs: [],
    vendors: [],
    poDrafts: [],
    vendorPurchaseOrders: []
  };
}

function readOpsData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(opsFile)) fs.writeFileSync(opsFile, JSON.stringify(defaultOpsData(), null, 2));
  try {
    const parsed = JSON.parse(fs.readFileSync(opsFile, 'utf8'));
    return { ...defaultOpsData(), ...parsed };
  } catch (e) {
    return defaultOpsData();
  }
}

function writeOpsData(data) {
  fs.writeFileSync(opsFile, JSON.stringify(data, null, 2));
}

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) return 'lb';
  if (['ea', 'each', 'ct', 'count', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units'].includes(unit)) return 'each';
  return 'each';
}

function normalizeIntakeQuantity(item, unit) {
  if (unit === 'lb') {
    return toNumber(item.requested_weight ?? item.quantity ?? item.amount, 0);
  }
  return toNumber(item.requested_qty ?? item.quantity ?? item.amount, 0);
}

function normalizeReceiptRules(input) {
  const overReceipt = String(input?.over_receipt_policy || 'cap').trim().toLowerCase();
  const backorder = String(input?.backorder_policy || 'open').trim().toLowerCase();
  return {
    over_receipt_policy: ['reject', 'cap', 'allow'].includes(overReceipt) ? overReceipt : 'cap',
    backorder_policy: ['open', 'waive'].includes(backorder) ? backorder : 'open',
  };
}

function genPoNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PO-${stamp}-${rand}`;
}

function normalizePoLine(line, index) {
  const orderedQty = Math.max(0, toNumber(line.ordered_qty ?? line.quantity, 0));
  const receivedQty = Math.max(0, toNumber(line.received_qty, 0));
  const unitCost = Math.max(0, toNumber(line.unit_cost ?? line.estimated_unit_cost, 0));
  const unit = normalizeUnit(line.unit);
  const overReceivedQty = Math.max(0, toNumber(line.over_received_qty, 0));
  const backorderedQty = Math.max(0, toNumber(line.backordered_qty, Math.max(0, orderedQty - Math.min(receivedQty, orderedQty))));
  const waivedBackorderQty = Math.max(0, toNumber(line.waived_backorder_qty, 0));
  return {
    line_no: index + 1,
    product_id: line.product_id || null,
    item_number: String(line.item_number || '').trim() || null,
    product_name: String(line.product_name || line.name || '').trim(),
    unit,
    ordered_qty: parseFloat(orderedQty.toFixed(3)),
    received_qty: parseFloat(receivedQty.toFixed(3)),
    over_received_qty: parseFloat(overReceivedQty.toFixed(3)),
    backordered_qty: parseFloat(backorderedQty.toFixed(3)),
    waived_backorder_qty: parseFloat(waivedBackorderQty.toFixed(3)),
    unit_cost: parseFloat(unitCost.toFixed(4)),
    line_total: parseFloat((orderedQty * unitCost).toFixed(2)),
    received_total: parseFloat((receivedQty * unitCost).toFixed(2)),
    urgency: line.urgency || 'normal',
    match_status: line.match_status || 'matched'
  };
}

function summarizeVendorPo(po) {
  const lines = Array.isArray(po.lines) ? po.lines : [];
  const totalOrderedQty = lines.reduce((sum, l) => sum + toNumber(l.ordered_qty, 0), 0);
  const totalReceivedQty = lines.reduce((sum, l) => sum + toNumber(l.received_qty, 0), 0);
  const totalOverReceivedQty = lines.reduce((sum, l) => sum + toNumber(l.over_received_qty, 0), 0);
  const totalBackorderedQty = lines.reduce((sum, l) => sum + toNumber(l.backordered_qty, 0), 0);
  const totalWaivedBackorderQty = lines.reduce((sum, l) => sum + toNumber(l.waived_backorder_qty, 0), 0);
  const totalOrderedCost = lines.reduce((sum, l) => sum + toNumber(l.line_total, 0), 0);
  const totalReceivedCost = lines.reduce((sum, l) => sum + toNumber(l.received_total, 0), 0);
  const allClosed = lines.length > 0 && lines.every((line) => {
    const ordered = toNumber(line.ordered_qty, 0);
    const received = toNumber(line.received_qty, 0);
    const waived = toNumber(line.waived_backorder_qty, 0);
    const backordered = toNumber(line.backordered_qty, 0);
    return received >= ordered || backordered <= 0 || (received + waived) >= ordered;
  });
  const hasBackorders = totalBackorderedQty > 0;
  const hasReceipts = totalReceivedQty > 0;
  return {
    ...po,
    receipt_rules: normalizeReceiptRules(po.receipt_rules),
    line_count: lines.length,
    total_ordered_qty: parseFloat(totalOrderedQty.toFixed(3)),
    total_received_qty: parseFloat(totalReceivedQty.toFixed(3)),
    total_over_received_qty: parseFloat(totalOverReceivedQty.toFixed(3)),
    total_backordered_qty: parseFloat(totalBackorderedQty.toFixed(3)),
    total_waived_backorder_qty: parseFloat(totalWaivedBackorderQty.toFixed(3)),
    total_ordered_cost: parseFloat(totalOrderedCost.toFixed(2)),
    total_received_cost: parseFloat(totalReceivedCost.toFixed(2)),
    status: allClosed
      ? 'received'
      : (hasReceipts ? (hasBackorders ? 'backordered' : 'partial_received') : (po.status || 'open'))
  };
}

async function loadInventoryAndUsage(lookbackDays) {
  const lookbackStart = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: inventory, error: invErr }, { data: orders, error: ordErr }] = await Promise.all([
    supabase.from('seafood_inventory').select('*'),
    supabase.from('orders').select('items, created_at').gte('created_at', lookbackStart)
  ]);
  if (invErr) throw new Error(invErr.message);
  const missingOrdersTable = ordErr && /public\.orders|relation ["']?orders["']? does not exist|schema cache/i.test(String(ordErr.message || ''));
  if (ordErr && !missingOrdersTable) throw new Error(ordErr.message);
  if (missingOrdersTable) {
    console.warn('[ops] orders table not found while building usage stats; using empty usage history');
  }

  const usageByName = new Map();
  for (const order of (missingOrdersTable ? [] : (orders || []))) {
    for (const item of order.items || []) {
      const name = String(item.name || item.description || '').trim().toLowerCase();
      if (!name) continue;
      const qty = item.unit === 'lb'
        ? toNumber(item.actual_weight ?? item.requested_weight ?? item.quantity, 0)
        : toNumber(item.requested_qty ?? item.quantity ?? item.qty, 0);
      usageByName.set(name, (usageByName.get(name) || 0) + qty);
    }
  }

  return { inventory: inventory || [], usageByName, lookbackStart };
}

function buildProjectionRows(inventory, usageByName, { days, lookbackDays }) {
  return (inventory || []).map(i => {
    const key = String(i.name || i.description || '').trim().toLowerCase();
    const stock = toNumber(i.stock_qty ?? i.on_hand_qty, 0);
    const used = usageByName.get(key) || 0;
    const avgDaily = used / lookbackDays;
    const projectedRemaining = stock - avgDaily * days;
    return {
      product_id: i.id,
      product_name: i.name || i.description,
      unit: i.unit || 'unit',
      stock_qty: parseFloat(stock.toFixed(3)),
      avg_daily_usage: parseFloat(avgDaily.toFixed(3)),
      projection_days: days,
      projected_remaining_qty: parseFloat(projectedRemaining.toFixed(3)),
      days_until_stockout: avgDaily > 0 ? parseFloat((stock / avgDaily).toFixed(1)) : null
    };
  });
}

function buildPurchasingSuggestions(inventory, usageByName, { coverageDays, leadTimeDays, lookbackDays }) {
  return (inventory || []).map(i => {
    const key = String(i.name || i.description || '').trim().toLowerCase();
    const stock = toNumber(i.stock_qty ?? i.on_hand_qty, 0);
    const avgDaily = (usageByName.get(key) || 0) / lookbackDays;
    const target = avgDaily * (coverageDays + leadTimeDays);
    const reorderQty = Math.max(0, target - stock);
    return {
      product_id: i.id,
      product_name: i.name || i.description,
      unit: i.unit || 'unit',
      stock_qty: parseFloat(stock.toFixed(3)),
      avg_daily_usage: parseFloat(avgDaily.toFixed(3)),
      lead_time_days: leadTimeDays,
      coverage_days: coverageDays,
      suggested_order_qty: parseFloat(reorderQty.toFixed(3)),
      estimated_unit_cost: parseFloat(toNumber(i.cost, 0).toFixed(4)),
      urgency: reorderQty <= 0 ? 'none' : (stock <= avgDaily * leadTimeDays ? 'high' : 'normal')
    };
  }).filter(s => s.suggested_order_qty > 0);
}

function resolveInventoryMatch(item, inventory) {
  const itemNumber = String(item.item_number || item.product_id || '').trim();
  const intakeName = String(item.name || item.product_name || '').trim().toLowerCase();
  if (!itemNumber && !intakeName) return null;

  if (itemNumber) {
    const byNumber = (inventory || []).find(inv => String(inv.item_number || '').trim() === itemNumber);
    if (byNumber) return byNumber;
  }

  const exact = (inventory || []).find((inv) => {
    const invName = String(inv.name || inv.description || '').trim().toLowerCase();
    return invName && invName === intakeName;
  });
  if (exact) return exact;

  const partial = (inventory || []).find((inv) => {
    const invName = String(inv.name || inv.description || '').trim().toLowerCase();
    return invName && intakeName && (invName.includes(intakeName) || intakeName.includes(invName));
  });
  return partial || null;
}

module.exports = {
  dataDir,
  opsFile,
  defaultOpsData,
  readOpsData,
  writeOpsData,
  genId,
  toNumber,
  normalizeUnit,
  normalizeIntakeQuantity,
  normalizeReceiptRules,
  genPoNumber,
  normalizePoLine,
  summarizeVendorPo,
  loadInventoryAndUsage,
  buildProjectionRows,
  buildPurchasingSuggestions,
  resolveInventoryMatch,
};
