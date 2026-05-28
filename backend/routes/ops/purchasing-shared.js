const { supabase } = require('../../services/supabase');
const { scopeQueryByContext } = require('../../services/operating-context');
const { applyInventoryLedgerEntry } = require('../../services/inventory-ledger');
const { genId, readOpsData, toNumber, writeOpsData } = require('./store');

const LOT_REQUIRED = /\b(mussel|clam|oyster)s?\b/i;

function normalizeUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) return 'lb';
  if (['ea', 'each', 'ct', 'count', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units'].includes(unit)) return 'each';
  return 'each';
}

function normalizeIntakeQuantity(item, unit) {
  if (unit === 'lb') return toNumber(item.requested_weight ?? item.quantity ?? item.amount, 0);
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

function parseDateSafe(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function round(value, digits) {
  return parseFloat(Number(value || 0).toFixed(digits));
}

function poLineRequiresLot(line) {
  return LOT_REQUIRED.test(
    `${line?.description || line?.product_name || line?.name || ''} ${line?.category || ''}`
  );
}

function normalizeLeadTimeProductKey(itemNumber, productName) {
  const normalizedItemNumber = String(itemNumber || '').trim().toLowerCase();
  if (normalizedItemNumber) return `item:${normalizedItemNumber}`;
  const normalizedProductName = String(productName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  return normalizedProductName ? `name:${normalizedProductName}` : '';
}

function lineMatchesReceiptLine(poLine, receiptLine) {
  const poLineNo = Number(poLine?.line_no);
  const receiptLineNo = Number(receiptLine?.line_no);
  if (Number.isFinite(poLineNo) && Number.isFinite(receiptLineNo) && poLineNo === receiptLineNo) {
    return true;
  }

  const poItemNumber = String(poLine?.item_number || '').trim().toLowerCase();
  const receiptItemNumber = String(receiptLine?.item_number || '').trim().toLowerCase();
  if (poItemNumber && receiptItemNumber && poItemNumber === receiptItemNumber) {
    return true;
  }

  const poProductKey = normalizeLeadTimeProductKey(poLine?.item_number, poLine?.product_name || poLine?.description || poLine?.name);
  const receiptProductKey = normalizeLeadTimeProductKey(receiptLine?.item_number, receiptLine?.product_name || receiptLine?.description || receiptLine?.name);
  return !!poProductKey && poProductKey === receiptProductKey;
}

function isClosedPoLine(line) {
  const ordered = toNumber(line?.ordered_qty, 0);
  const received = toNumber(line?.received_qty, 0);
  const waived = toNumber(line?.waived_backorder_qty, 0);
  const backordered = toNumber(line?.backordered_qty, 0);
  return received >= ordered || backordered <= 0 || (received + waived) >= ordered;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function calculateVendorPoLeadMetrics(po) {
  const createdAt = parseDateSafe(po.created_at);
  const receiptDates = (Array.isArray(po.receipts) ? po.receipts : [])
    .map((receipt) => parseDateSafe(receipt.received_at))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  const firstReceivedAt = receiptDates[0] || null;
  const latestReceivedAt = receiptDates[receiptDates.length - 1] || null;
  if (!createdAt || !firstReceivedAt) {
    return {
      first_received_at: firstReceivedAt ? firstReceivedAt.toISOString() : null,
      latest_received_at: latestReceivedAt ? latestReceivedAt.toISOString() : null,
      first_receipt_lead_time_days: null,
      first_receipt_lead_time_hours: null,
      full_receipt_lead_time_days: null,
    };
  }

  const firstLeadHours = (firstReceivedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const fullLeadHours = latestReceivedAt ? (latestReceivedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60) : null;
  return {
    first_received_at: firstReceivedAt.toISOString(),
    latest_received_at: latestReceivedAt ? latestReceivedAt.toISOString() : null,
    first_receipt_lead_time_days: round(firstLeadHours / 24, 2),
    first_receipt_lead_time_hours: round(firstLeadHours, 1),
    full_receipt_lead_time_days: po.status === 'received' && fullLeadHours != null ? round(fullLeadHours / 24, 2) : null,
  };
}

function calculateVendorPoLineLeadMetrics(po, line, fallbackPoMetrics = {}) {
  const createdAt = parseDateSafe(po.created_at);
  const receiptDates = (Array.isArray(po.receipts) ? po.receipts : [])
    .map((receipt) => {
      const receivedAt = parseDateSafe(receipt.received_at);
      if (!receivedAt) return null;
      const receiptLines = Array.isArray(receipt.lines) ? receipt.lines : [];
      return receiptLines.some((receiptLine) => lineMatchesReceiptLine(line, receiptLine)) ? receivedAt : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  if (!receiptDates.length && Number(toNumber(line.received_qty, 0)) > 0 && Array.isArray(po.lines) && po.lines.length === 1) {
    const fallbackFirst = parseDateSafe(fallbackPoMetrics.first_received_at);
    const fallbackLatest = parseDateSafe(fallbackPoMetrics.latest_received_at);
    if (fallbackFirst) receiptDates.push(fallbackFirst);
    if (fallbackLatest && (!fallbackFirst || fallbackLatest.getTime() !== fallbackFirst.getTime())) {
      receiptDates.push(fallbackLatest);
    }
    receiptDates.sort((left, right) => left.getTime() - right.getTime());
  }

  const firstReceivedAt = receiptDates[0] || null;
  const latestReceivedAt = receiptDates[receiptDates.length - 1] || null;
  if (!createdAt || !firstReceivedAt) {
    return {
      first_received_at: firstReceivedAt ? firstReceivedAt.toISOString() : null,
      latest_received_at: latestReceivedAt ? latestReceivedAt.toISOString() : null,
      first_receipt_lead_time_days: null,
      first_receipt_lead_time_hours: null,
      full_receipt_lead_time_days: null,
    };
  }

  const firstLeadHours = (firstReceivedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const fullLeadHours = latestReceivedAt ? (latestReceivedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60) : null;
  return {
    first_received_at: firstReceivedAt.toISOString(),
    latest_received_at: latestReceivedAt ? latestReceivedAt.toISOString() : null,
    first_receipt_lead_time_days: round(firstLeadHours / 24, 2),
    first_receipt_lead_time_hours: round(firstLeadHours, 1),
    full_receipt_lead_time_days: isClosedPoLine(line) && fullLeadHours != null ? round(fullLeadHours / 24, 2) : null,
  };
}

function buildVendorLeadTimeStats(orders, vendorName) {
  const normalizedVendor = String(vendorName || '').trim().toLowerCase();
  const matches = (orders || []).filter((po) => {
    if (!normalizedVendor) return true;
    return String(po.vendor || po.vendor_name || '').trim().toLowerCase() === normalizedVendor;
  });
  const leadTimes = matches
    .map((po) => Number(po.first_receipt_lead_time_days))
    .filter((value) => Number.isFinite(value));
  if (!leadTimes.length) {
    return {
      vendor: vendorName || null,
      receipt_count: 0,
      average_days: null,
      median_days: null,
      minimum_days: null,
      maximum_days: null,
      latest_days: null,
    };
  }

  const latestMeasured = [...matches]
    .filter((po) => Number.isFinite(Number(po.first_receipt_lead_time_days)))
    .sort((left, right) => String(right.first_received_at || '').localeCompare(String(left.first_received_at || '')))[0];

  return {
    vendor: vendorName || null,
    receipt_count: leadTimes.length,
    average_days: round(leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length, 2),
    median_days: round(median(leadTimes), 2),
    minimum_days: round(Math.min(...leadTimes), 2),
    maximum_days: round(Math.max(...leadTimes), 2),
    latest_days: latestMeasured ? round(Number(latestMeasured.first_receipt_lead_time_days), 2) : null,
  };
}

function buildVendorProductLeadTimeStats(orders, vendorName, line) {
  const normalizedVendor = String(vendorName || '').trim().toLowerCase();
  const productKey = normalizeLeadTimeProductKey(line?.item_number, line?.product_name || line?.description || line?.name);
  const productLabel = String(line?.product_name || line?.item_number || line?.description || '').trim() || null;
  const itemNumber = String(line?.item_number || '').trim() || null;

  if (!productKey) {
    return {
      vendor: vendorName || null,
      item_number: itemNumber,
      product_name: productLabel,
      receipt_count: 0,
      average_days: null,
      median_days: null,
      minimum_days: null,
      maximum_days: null,
      latest_days: null,
    };
  }

  const matches = [];
  for (const po of (orders || [])) {
    const poVendor = String(po.vendor || po.vendor_name || '').trim().toLowerCase();
    if (normalizedVendor && poVendor !== normalizedVendor) continue;
    for (const poLine of Array.isArray(po.lines) ? po.lines : []) {
      const poLineKey = normalizeLeadTimeProductKey(poLine.item_number, poLine.product_name || poLine.description || poLine.name);
      if (!poLineKey || poLineKey !== productKey) continue;
      matches.push(poLine);
    }
  }

  const leadTimes = matches
    .map((poLine) => Number(poLine.first_receipt_lead_time_days))
    .filter((value) => Number.isFinite(value));

  if (!leadTimes.length) {
    return {
      vendor: vendorName || null,
      item_number: itemNumber,
      product_name: productLabel,
      receipt_count: 0,
      average_days: null,
      median_days: null,
      minimum_days: null,
      maximum_days: null,
      latest_days: null,
    };
  }

  const latestMeasured = [...matches]
    .filter((poLine) => Number.isFinite(Number(poLine.first_receipt_lead_time_days)))
    .sort((left, right) => String(right.first_received_at || right.latest_received_at || '').localeCompare(String(left.first_received_at || left.latest_received_at || '')))[0];

  return {
    vendor: vendorName || null,
    item_number: itemNumber,
    product_name: productLabel,
    receipt_count: leadTimes.length,
    average_days: round(leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length, 2),
    median_days: round(median(leadTimes), 2),
    minimum_days: round(Math.min(...leadTimes), 2),
    maximum_days: round(Math.max(...leadTimes), 2),
    latest_days: latestMeasured ? round(Number(latestMeasured.first_receipt_lead_time_days), 2) : null,
  };
}

function summarizeVendorPurchaseOrders(orders) {
  const summarized = (orders || []).map((po) => {
    const summarizedPo = {
      ...summarizeVendorPo(po),
    };
    const poLeadMetrics = calculateVendorPoLeadMetrics(summarizedPo);
    const lineMetrics = (Array.isArray(summarizedPo.lines) ? summarizedPo.lines : []).map((line) => ({
      ...line,
      ...calculateVendorPoLineLeadMetrics(summarizedPo, line, poLeadMetrics),
    }));
    return {
      ...summarizedPo,
      ...poLeadMetrics,
      lines: lineMetrics,
    };
  });

  return summarized.map((po) => ({
    ...po,
    lead_time_history: buildVendorLeadTimeStats(summarized, po.vendor || po.vendor_name),
    lines: (Array.isArray(po.lines) ? po.lines : []).map((line) => {
      const lineLeadTimeHistory = buildVendorProductLeadTimeStats(summarized, po.vendor || po.vendor_name, line);
      return {
        ...line,
        lead_time_history: lineLeadTimeHistory.receipt_count ? lineLeadTimeHistory : null,
      };
    }),
  }));
}

function resolveHistoricalLeadTimeDays(orders, vendorName, line) {
  const hasLineContext = !!normalizeLeadTimeProductKey(line?.item_number, line?.product_name || line?.description || line?.name);
  if (hasLineContext) {
    const productPreferred = buildVendorProductLeadTimeStats(orders, vendorName, line);
    if (productPreferred.receipt_count) {
      return {
        leadTimeDays: Math.max(0, Math.ceil(Number(productPreferred.average_days || 0))),
        source: 'historical_product',
        history: productPreferred,
      };
    }
  }

  const preferred = buildVendorLeadTimeStats(orders, vendorName);
  if (preferred.receipt_count) {
    return {
      leadTimeDays: Math.max(0, Math.ceil(Number(preferred.average_days || 0))),
      source: 'historical',
      history: preferred,
    };
  }

  if (hasLineContext) {
    const productGlobal = buildVendorProductLeadTimeStats(orders, null, line);
    if (productGlobal.receipt_count) {
      return {
        leadTimeDays: Math.max(0, Math.ceil(Number(productGlobal.average_days || 0))),
        source: 'historical_product_global',
        history: productGlobal,
      };
    }
  }

  const global = buildVendorLeadTimeStats(orders, null);
  if (global.receipt_count) {
    return {
      leadTimeDays: Math.max(0, Math.ceil(Number(global.average_days || 0))),
      source: 'historical_global',
      history: global,
    };
  }

  return {
    leadTimeDays: 5,
    source: 'default',
    history: global,
  };
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
    category: String(line.category || '').trim() || null,
    unit,
    ordered_qty: parseFloat(orderedQty.toFixed(3)),
    received_qty: parseFloat(receivedQty.toFixed(3)),
    over_received_qty: parseFloat(overReceivedQty.toFixed(3)),
    backordered_qty: parseFloat(backorderedQty.toFixed(3)),
    waived_backorder_qty: parseFloat(waivedBackorderQty.toFixed(3)),
    unit_cost: parseFloat(unitCost.toFixed(4)),
    line_total: parseFloat((orderedQty * unitCost).toFixed(2)),
    received_total: parseFloat((receivedQty * unitCost).toFixed(2)),
    lot_number: String(line.lot_number || '').trim() || null,
    urgency: line.urgency || 'normal',
    match_status: line.match_status || 'matched',
  };
}

function summarizeVendorPo(po) {
  const lines = Array.isArray(po.lines) ? po.lines : [];
  const totalOrderedQty = lines.reduce((sum, line) => sum + toNumber(line.ordered_qty, 0), 0);
  const totalReceivedQty = lines.reduce((sum, line) => sum + toNumber(line.received_qty, 0), 0);
  const totalOverReceivedQty = lines.reduce((sum, line) => sum + toNumber(line.over_received_qty, 0), 0);
  const totalBackorderedQty = lines.reduce((sum, line) => sum + toNumber(line.backordered_qty, 0), 0);
  const totalWaivedBackorderQty = lines.reduce((sum, line) => sum + toNumber(line.waived_backorder_qty, 0), 0);
  const totalOrderedCost = lines.reduce((sum, line) => sum + toNumber(line.line_total, 0), 0);
  const totalReceivedCost = lines.reduce((sum, line) => sum + toNumber(line.received_total, 0), 0);
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
      : (hasReceipts ? (hasBackorders ? 'backordered' : 'partial_received') : (po.status || 'open')),
  };
}

async function loadInventoryAndUsage(lookbackDays, context = null) {
  const lookbackStart = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: inventory, error: invErr }, { data: orders, error: ordErr }] = await Promise.all([
    scopeQueryByContext(supabase.from('products').select('*'), context),
    scopeQueryByContext(supabase.from('orders').select('items, created_at, company_id, location_id'), context).gte('created_at', lookbackStart),
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
  return (inventory || []).map((item) => {
    const key = String(item.name || item.description || '').trim().toLowerCase();
    const stock = toNumber(item.stock_qty ?? item.on_hand_qty, 0);
    const used = usageByName.get(key) || 0;
    const avgDaily = used / lookbackDays;
    const projectedRemaining = stock - avgDaily * days;
    return {
      product_id: item.id,
      product_name: item.name || item.description,
      unit: item.unit || 'unit',
      stock_qty: parseFloat(stock.toFixed(3)),
      avg_daily_usage: parseFloat(avgDaily.toFixed(3)),
      projection_days: days,
      projected_remaining_qty: parseFloat(projectedRemaining.toFixed(3)),
      days_until_stockout: avgDaily > 0 ? parseFloat((stock / avgDaily).toFixed(1)) : null,
    };
  });
}

function buildPurchasingSuggestions(inventory, usageByName, { coverageDays, leadTimeDays, lookbackDays, leadTimeResolver }) {
  const defaultLeadTimeDays = leadTimeDays;
  return (inventory || []).map((item) => {
    const resolvedLead = typeof leadTimeResolver === 'function' ? leadTimeResolver(item) : null;
    const leadTimeDays = Math.max(0, toNumber(resolvedLead?.leadTimeDays, defaultLeadTimeDays));
    const key = String(item.name || item.description || '').trim().toLowerCase();
    const stock = toNumber(item.stock_qty ?? item.on_hand_qty, 0);
    const avgDaily = (usageByName.get(key) || 0) / lookbackDays;
    const target = avgDaily * (coverageDays + leadTimeDays);
    const reorderQty = Math.max(0, target - stock);
    return {
      product_id: item.id,
      item_number: String(item.item_number || '').trim() || null,
      product_name: item.name || item.description,
      unit: item.unit || 'unit',
      stock_qty: parseFloat(stock.toFixed(3)),
      avg_daily_usage: parseFloat(avgDaily.toFixed(3)),
      lead_time_days: leadTimeDays,
      lead_time_source: resolvedLead?.source || 'manual',
      historical_lead_time: resolvedLead?.history || null,
      coverage_days: coverageDays,
      suggested_order_qty: parseFloat(reorderQty.toFixed(3)),
      estimated_unit_cost: parseFloat(toNumber(item.cost, 0).toFixed(4)),
      urgency: reorderQty <= 0 ? 'none' : (stock <= avgDaily * leadTimeDays ? 'high' : 'normal'),
    };
  }).filter((suggestion) => suggestion.suggested_order_qty > 0);
}

function resolveInventoryMatch(item, inventory) {
  const itemNumber = String(item.item_number || item.product_id || '').trim();
  const intakeName = String(item.name || item.product_name || '').trim().toLowerCase();
  if (!itemNumber && !intakeName) return null;

  if (itemNumber) {
    const byNumber = (inventory || []).find((row) => String(row.item_number || '').trim() === itemNumber);
    if (byNumber) return byNumber;
  }

  const exact = (inventory || []).find((row) => {
    const inventoryName = String(row.name || row.description || '').trim().toLowerCase();
    return inventoryName && inventoryName === intakeName;
  });
  if (exact) return exact;

  return (inventory || []).find((row) => {
    const inventoryName = String(row.name || row.description || '').trim().toLowerCase();
    return inventoryName && intakeName && (inventoryName.includes(intakeName) || intakeName.includes(inventoryName));
  }) || null;
}

/**
 * Load vendor purchase orders for the current tenant context, sourcing from
 * Supabase. Falls back to an empty array if the workflow schema isn't present.
 * This replaces the historical ops.json read for planning queries.
 */
async function loadVendorPurchaseOrdersForContext(context) {
  try {
    const { loadVendorPurchaseOrdersFromDb } = require('../../services/purchase-order-workflows');
    const orders = await loadVendorPurchaseOrdersFromDb(context || {});
    return Array.isArray(orders) ? orders : [];
  } catch (error) {
    // Schema missing or other failure — historical lead-time inference simply
    // returns no measurements, callers default to manual lead time.
    return [];
  }
}

module.exports = {
  applyInventoryLedgerEntry,
  buildVendorLeadTimeStats,
  buildVendorProductLeadTimeStats,
  buildProjectionRows,
  buildPurchasingSuggestions,
  calculateVendorPoLeadMetrics,
  calculateVendorPoLineLeadMetrics,
  genId,
  genPoNumber,
  loadInventoryAndUsage,
  loadVendorPurchaseOrdersForContext,
  normalizeIntakeQuantity,
  normalizePoLine,
  normalizeReceiptRules,
  normalizeUnit,
  poLineRequiresLot,
  readOpsData,
  resolveHistoricalLeadTimeDays,
  resolveInventoryMatch,
  summarizeVendorPo,
  summarizeVendorPurchaseOrders,
  supabase,
  toNumber,
  writeOpsData,
};
