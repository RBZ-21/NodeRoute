const express = require('express');
const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');

const router = express.Router();

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

router.get('/projections', authenticateToken, async (req, res) => {
  const days = Math.max(1, Math.min(90, parseInt(req.query.days || '30', 10)));
  const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));
  try {
    const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
    const projections = buildProjectionRows(inventory, usageByName, { days, lookbackDays });
    res.json({ days, lookbackDays, generated_at: new Date().toISOString(), projections });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/purchasing-suggestions', authenticateToken, async (req, res) => {
  const coverageDays = Math.max(1, Math.min(90, parseInt(req.query.coverageDays || '30', 10)));
  const leadTimeDays = Math.max(0, Math.min(60, parseInt(req.query.leadTimeDays || '5', 10)));
  const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));
  try {
    const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
    const suggestions = buildPurchasingSuggestions(inventory, usageByName, { coverageDays, leadTimeDays, lookbackDays });
    res.json({ leadTimeDays, coverageDays, lookbackDays, generated_at: new Date().toISOString(), suggestions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/purchase-order-drafts', authenticateToken, (req, res) => {
  const ops = readOpsData();
  res.json((ops.poDrafts || []).slice(0, 100));
});

router.post('/purchase-order-drafts/from-suggestions', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const coverageDays = Math.max(1, Math.min(90, parseInt(req.body.coverageDays || '30', 10)));
  const leadTimeDays = Math.max(0, Math.min(60, parseInt(req.body.leadTimeDays || '5', 10)));
  const lookbackDays = Math.max(7, Math.min(90, parseInt(req.body.lookbackDays || '30', 10)));
  const minOrderQty = Math.max(0, toNumber(req.body.minOrderQty, 0));
  const maxLines = Math.max(1, Math.min(200, parseInt(req.body.maxLines || '50', 10)));
  const vendor = String(req.body.vendor || '').trim() || 'Unassigned Vendor';
  const notes = String(req.body.notes || '').trim();
  const includedUrgencies = Array.isArray(req.body.includeUrgencies) && req.body.includeUrgencies.length
    ? new Set(req.body.includeUrgencies.map(v => String(v).toLowerCase()))
    : new Set(['high', 'normal']);

  try {
    const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
    const suggestions = buildPurchasingSuggestions(inventory, usageByName, { coverageDays, leadTimeDays, lookbackDays });
    const urgencyRank = { high: 0, normal: 1, none: 2 };
    const selected = suggestions
      .filter(s => includedUrgencies.has(String(s.urgency || '').toLowerCase()) && s.suggested_order_qty > minOrderQty)
      .sort((a, b) => (urgencyRank[a.urgency] - urgencyRank[b.urgency]) || (b.suggested_order_qty - a.suggested_order_qty))
      .slice(0, maxLines);

    if (!selected.length) {
      return res.status(400).json({ error: 'No reorder suggestions matched the draft filters' });
    }

    const nowIso = new Date().toISOString();
    const lines = selected.map((s, idx) => {
      const unitCost = toNumber(s.estimated_unit_cost, 0);
      const qty = toNumber(s.suggested_order_qty, 0);
      return {
        line_no: idx + 1,
        product_id: s.product_id || null,
        product_name: s.product_name,
        unit: s.unit,
        quantity: parseFloat(qty.toFixed(3)),
        estimated_unit_cost: parseFloat(unitCost.toFixed(4)),
        estimated_line_total: parseFloat((qty * unitCost).toFixed(2)),
        urgency: s.urgency,
        stock_qty: s.stock_qty,
        avg_daily_usage: s.avg_daily_usage
      };
    });

    const draft = {
      id: genId('pod'),
      draft_number: `DRAFT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      status: 'draft',
      vendor,
      notes,
      source: { coverageDays, leadTimeDays, lookbackDays, minOrderQty, maxLines },
      lines,
      line_count: lines.length,
      total_suggested_qty: parseFloat(lines.reduce((sum, l) => sum + toNumber(l.quantity, 0), 0).toFixed(3)),
      total_estimated_cost: parseFloat(lines.reduce((sum, l) => sum + toNumber(l.estimated_line_total, 0), 0).toFixed(2)),
      created_by: req.user?.name || req.user?.email || 'system',
      created_at: nowIso,
      updated_at: nowIso
    };

    const ops = readOpsData();
    ops.poDrafts = ops.poDrafts || [];
    ops.poDrafts.unshift(draft);
    writeOpsData(ops);
    res.json(draft);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/purchase-order-drafts/from-order-intake', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const intakeItems = Array.isArray(req.body.intakeItems) ? req.body.intakeItems : [];
  if (!intakeItems.length) return res.status(400).json({ error: 'intakeItems is required' });

  const leadTimeDays = Math.max(0, Math.min(60, parseInt(req.body.leadTimeDays || '5', 10)));
  const lookbackDays = Math.max(7, Math.min(90, parseInt(req.body.lookbackDays || '30', 10)));
  const minOrderQty = Math.max(0, toNumber(req.body.minOrderQty, 0));
  const maxLines = Math.max(1, Math.min(200, parseInt(req.body.maxLines || '50', 10)));
  const vendor = String(req.body.vendor || '').trim() || 'Unassigned Vendor';
  const notes = String(req.body.notes || '').trim();

  try {
    const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
    const normalizedIntake = intakeItems.map((raw) => {
      const unit = normalizeUnit(raw.unit);
      const requested = normalizeIntakeQuantity(raw, unit);
      return {
        name: String(raw.name || raw.product_name || '').trim(),
        item_number: String(raw.item_number || raw.product_id || '').trim(),
        unit,
        requested_qty: Math.max(0, requested),
      };
    }).filter((item) => item.name && item.requested_qty > 0);

    if (!normalizedIntake.length) {
      return res.status(400).json({ error: 'No valid intake items were provided' });
    }

    const grouped = new Map();
    for (const item of normalizedIntake) {
      const key = item.item_number || `${item.name.toLowerCase()}|${item.unit}`;
      const current = grouped.get(key) || { ...item, requested_qty: 0 };
      current.requested_qty += item.requested_qty;
      grouped.set(key, current);
    }

    const evaluated = [...grouped.values()].map((item) => {
      const matched = resolveInventoryMatch(item, inventory);
      const matchedName = String(matched?.name || matched?.description || '').trim();
      const usageKey = matchedName.toLowerCase();
      const stock = Math.max(0, toNumber(matched?.stock_qty ?? matched?.on_hand_qty, 0));
      const avgDaily = matched ? (usageByName.get(usageKey) || 0) / lookbackDays : 0;
      const intakeGap = Math.max(0, item.requested_qty - stock);
      const leadBuffer = Math.max(0, avgDaily * leadTimeDays);
      const suggestedOrderQty = matched
        ? Math.max(0, intakeGap + leadBuffer)
        : Math.max(0, item.requested_qty);

      return {
        product_id: matched?.id || null,
        item_number: matched?.item_number || item.item_number || null,
        product_name: matchedName || item.name,
        unit: normalizeUnit(matched?.unit || item.unit),
        requested_intake_qty: parseFloat(item.requested_qty.toFixed(3)),
        stock_qty: parseFloat(stock.toFixed(3)),
        stock_gap_qty: parseFloat(intakeGap.toFixed(3)),
        avg_daily_usage: parseFloat(avgDaily.toFixed(3)),
        suggested_order_qty: parseFloat(suggestedOrderQty.toFixed(3)),
        estimated_unit_cost: parseFloat(toNumber(matched?.cost, 0).toFixed(4)),
        urgency: !matched || intakeGap > 0 ? 'high' : (leadBuffer > 0 ? 'normal' : 'none'),
        match_status: matched ? 'matched' : 'unmatched'
      };
    });

    const selected = evaluated
      .filter((line) => line.suggested_order_qty > minOrderQty)
      .sort((a, b) => {
        if (a.urgency !== b.urgency) return a.urgency === 'high' ? -1 : 1;
        return b.suggested_order_qty - a.suggested_order_qty;
      })
      .slice(0, maxLines);

    if (!selected.length) {
      return res.status(400).json({ error: 'No stock gaps found for this intake payload' });
    }

    const nowIso = new Date().toISOString();
    const lines = selected.map((s, idx) => {
      const qty = toNumber(s.suggested_order_qty, 0);
      const unitCost = toNumber(s.estimated_unit_cost, 0);
      return {
        line_no: idx + 1,
        product_id: s.product_id,
        item_number: s.item_number,
        product_name: s.product_name,
        unit: s.unit,
        quantity: parseFloat(qty.toFixed(3)),
        estimated_unit_cost: parseFloat(unitCost.toFixed(4)),
        estimated_line_total: parseFloat((qty * unitCost).toFixed(2)),
        urgency: s.urgency,
        match_status: s.match_status,
        requested_intake_qty: s.requested_intake_qty,
        stock_qty: s.stock_qty,
        stock_gap_qty: s.stock_gap_qty,
        avg_daily_usage: s.avg_daily_usage
      };
    });

    const draft = {
      id: genId('pod'),
      draft_number: `DRAFT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      status: 'draft',
      vendor,
      notes,
      source: {
        mode: 'order_intake',
        leadTimeDays,
        lookbackDays,
        minOrderQty,
        maxLines,
        intake_item_count: normalizedIntake.length,
        intake_message_excerpt: String(req.body.intakeMessage || '').trim().slice(0, 200) || null
      },
      lines,
      line_count: lines.length,
      total_suggested_qty: parseFloat(lines.reduce((sum, l) => sum + toNumber(l.quantity, 0), 0).toFixed(3)),
      total_estimated_cost: parseFloat(lines.reduce((sum, l) => sum + toNumber(l.estimated_line_total, 0), 0).toFixed(2)),
      created_by: req.user?.name || req.user?.email || 'system',
      created_at: nowIso,
      updated_at: nowIso
    };

    const ops = readOpsData();
    ops.poDrafts = ops.poDrafts || [];
    ops.poDrafts.unshift(draft);
    writeOpsData(ops);
    res.json(draft);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/purchase-order-drafts/:id/status', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const allowed = new Set(['draft', 'ready', 'ordered', 'archived']);
  const nextStatus = String(req.body.status || '').toLowerCase();
  if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'Invalid status' });

  const ops = readOpsData();
  ops.poDrafts = ops.poDrafts || [];
  const idx = ops.poDrafts.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Draft not found' });

  const current = ops.poDrafts[idx];
  const updated = {
    ...current,
    status: nextStatus,
    updated_at: new Date().toISOString(),
    updated_by: req.user?.name || req.user?.email || 'system'
  };
  ops.poDrafts[idx] = updated;
  writeOpsData(ops);
  res.json(updated);
});

router.get('/vendor-purchase-orders', authenticateToken, (req, res) => {
  const ops = readOpsData();
  const orders = (ops.vendorPurchaseOrders || [])
    .map(po => summarizeVendorPo(po))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  res.json(orders.slice(0, 200));
});

router.post('/vendor-purchase-orders/from-draft/:id', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const ops = readOpsData();
  ops.poDrafts = ops.poDrafts || [];
  ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
  const draftIdx = ops.poDrafts.findIndex(d => d.id === req.params.id);
  if (draftIdx === -1) return res.status(404).json({ error: 'Draft not found' });

  const draft = ops.poDrafts[draftIdx];
  const sourceLines = Array.isArray(draft.lines) ? draft.lines : [];
  if (!sourceLines.length) return res.status(400).json({ error: 'Draft has no lines' });

  const vendor = String(req.body.vendor || draft.vendor || '').trim() || 'Unassigned Vendor';
  const receiptRules = normalizeReceiptRules(req.body.receiptRules || draft.receipt_rules);
  const po = summarizeVendorPo({
    id: genId('po'),
    po_number: String(req.body.poNumber || '').trim() || genPoNumber(),
    vendor,
    status: 'open',
    expected_date: req.body.expectedDate || null,
    notes: String(req.body.notes || draft.notes || '').trim() || null,
    source_draft_id: draft.id,
    receipt_rules: receiptRules,
    lines: sourceLines.map((line, idx) => normalizePoLine(line, idx)),
    receipts: [],
    created_by: req.user?.name || req.user?.email || 'system',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  ops.vendorPurchaseOrders.unshift(po);
  ops.poDrafts[draftIdx] = {
    ...draft,
    status: 'ordered',
    linked_vendor_po_id: po.id,
    updated_at: new Date().toISOString(),
    updated_by: req.user?.name || req.user?.email || 'system'
  };
  writeOpsData(ops);
  res.json(po);
});

router.post('/vendor-purchase-orders', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const linesInput = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!linesInput.length) return res.status(400).json({ error: 'lines are required' });

  const normalizedLines = linesInput
    .map((line, idx) => normalizePoLine(line, idx))
    .filter(line => line.product_name && line.ordered_qty > 0);
  if (!normalizedLines.length) return res.status(400).json({ error: 'No valid PO lines were provided' });

  const vendor = String(req.body.vendor || '').trim();
  if (!vendor) return res.status(400).json({ error: 'vendor is required' });
  const receiptRules = normalizeReceiptRules(req.body.receiptRules);

  const po = summarizeVendorPo({
    id: genId('po'),
    po_number: String(req.body.poNumber || '').trim() || genPoNumber(),
    vendor,
    status: 'open',
    expected_date: req.body.expectedDate || null,
    notes: String(req.body.notes || '').trim() || null,
    source_draft_id: req.body.sourceDraftId || null,
    receipt_rules: receiptRules,
    lines: normalizedLines,
    receipts: [],
    created_by: req.user?.name || req.user?.email || 'system',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  const ops = readOpsData();
  ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
  ops.vendorPurchaseOrders.unshift(po);
  writeOpsData(ops);
  res.json(po);
});

router.patch('/vendor-purchase-orders/:id/status', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const allowed = new Set(['open', 'partial_received', 'backordered', 'received', 'cancelled']);
  const nextStatus = String(req.body.status || '').trim().toLowerCase();
  if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'Invalid status' });

  const ops = readOpsData();
  ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
  const idx = ops.vendorPurchaseOrders.findIndex(po => po.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Vendor PO not found' });
  const current = summarizeVendorPo(ops.vendorPurchaseOrders[idx]);

  if ((current.status === 'received' || current.status === 'cancelled') && nextStatus === 'open') {
    return res.status(400).json({ error: `Cannot reopen PO from ${current.status}` });
  }

  const updated = {
    ...current,
    status: nextStatus,
    updated_at: new Date().toISOString(),
    updated_by: req.user?.name || req.user?.email || 'system'
  };
  ops.vendorPurchaseOrders[idx] = updated;
  writeOpsData(ops);
  res.json(updated);
});

router.post('/vendor-purchase-orders/:id/receive', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const receiveLines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!receiveLines.length) return res.status(400).json({ error: 'lines are required' });

  const ops = readOpsData();
  ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
  const poIdx = ops.vendorPurchaseOrders.findIndex(po => po.id === req.params.id);
  if (poIdx === -1) return res.status(404).json({ error: 'Vendor PO not found' });

  const po = summarizeVendorPo(ops.vendorPurchaseOrders[poIdx]);
  if (po.status === 'received' || po.status === 'cancelled') {
    return res.status(400).json({ error: `Cannot receive against PO with status ${po.status}` });
  }
  const receiptRules = normalizeReceiptRules({ ...(po.receipt_rules || {}), ...(req.body.receiptRules || {}) });
  const overReceiptPolicy = receiptRules.over_receipt_policy;
  const backorderPolicy = receiptRules.backorder_policy;

  // Validate reject-policy over-receipts before mutating inventory/PO state.
  if (overReceiptPolicy === 'reject') {
    const rejectedLines = [];
    for (const rawLine of receiveLines) {
      const targetLineNo = parseInt(rawLine.line_no, 10);
      const poLine = po.lines.find(l => l.line_no === targetLineNo)
        || po.lines.find(l => l.item_number && String(rawLine.item_number || '').trim() === l.item_number)
        || po.lines.find(l => String(l.product_name || '').toLowerCase() === String(rawLine.product_name || '').trim().toLowerCase());
      if (!poLine) continue;
      const requestedQty = Math.max(0, toNumber(rawLine.qty_received ?? rawLine.quantity, 0));
      if (requestedQty <= 0) continue;
      const ordered = Math.max(0, toNumber(poLine.ordered_qty, 0));
      const alreadyReceived = Math.max(0, toNumber(poLine.received_qty, 0));
      const remainingBefore = Math.max(0, ordered - Math.min(alreadyReceived, ordered));
      if (requestedQty > remainingBefore) {
        rejectedLines.push({
          line_no: poLine.line_no,
          product_name: poLine.product_name,
          requested_receive_qty: parseFloat(requestedQty.toFixed(3)),
          remaining_qty: parseFloat(remainingBefore.toFixed(3)),
          over_receipt_qty: parseFloat((requestedQty - remainingBefore).toFixed(3))
        });
      }
    }
    if (rejectedLines.length) {
      return res.status(409).json({
        error: 'Over-receipt rejected by receipt policy',
        code: 'OVER_RECEIPT_REJECTED',
        over_receipt_policy: overReceiptPolicy,
        rejected_lines: rejectedLines
      });
    }
  }

  const { data: inventory, error: invErr } = await supabase.from('seafood_inventory').select('*');
  if (invErr) return res.status(500).json({ error: invErr.message });
  const inventoryRows = inventory || [];

  const receiptLines = [];
  let totalRequestedQty = 0;
  let totalAcceptedQty = 0;
  let totalRejectedQty = 0;
  let totalOverReceiptQty = 0;

  for (const rawLine of receiveLines) {
    const targetLineNo = parseInt(rawLine.line_no, 10);
    const poLine = po.lines.find(l => l.line_no === targetLineNo)
      || po.lines.find(l => l.item_number && String(rawLine.item_number || '').trim() === l.item_number)
      || po.lines.find(l => String(l.product_name || '').toLowerCase() === String(rawLine.product_name || '').trim().toLowerCase());
    if (!poLine) continue;

    const requestedQty = Math.max(0, toNumber(rawLine.qty_received ?? rawLine.quantity, 0));
    if (requestedQty <= 0) continue;
    totalRequestedQty += requestedQty;

    const orderedQty = Math.max(0, toNumber(poLine.ordered_qty, 0));
    const previousReceivedQty = Math.max(0, toNumber(poLine.received_qty, 0));
    const previouslyReceivedTowardOrdered = Math.min(previousReceivedQty, orderedQty);
    const remainingBefore = Math.max(0, orderedQty - previouslyReceivedTowardOrdered);
    const overRequestedQty = Math.max(0, requestedQty - remainingBefore);
    const acceptedQty = overReceiptPolicy === 'allow'
      ? requestedQty
      : Math.min(remainingBefore, requestedQty);
    const rejectedQty = overReceiptPolicy === 'cap' ? Math.max(0, requestedQty - acceptedQty) : 0;
    if (acceptedQty <= 0) continue;
    totalAcceptedQty += acceptedQty;
    totalRejectedQty += rejectedQty;
    totalOverReceiptQty += overRequestedQty;

    const unitCost = Math.max(0, toNumber(rawLine.unit_cost, toNumber(poLine.unit_cost, 0)));
    poLine.received_qty = parseFloat((previousReceivedQty + acceptedQty).toFixed(3));
    poLine.over_received_qty = parseFloat((Math.max(0, toNumber(poLine.over_received_qty, 0)) + (overReceiptPolicy === 'allow' ? overRequestedQty : 0)).toFixed(3));
    poLine.unit_cost = parseFloat(unitCost.toFixed(4));
    poLine.line_total = parseFloat((orderedQty * unitCost).toFixed(2));
    poLine.received_total = parseFloat((toNumber(poLine.received_qty, 0) * unitCost).toFixed(2));
    const receivedTowardOrdered = Math.min(toNumber(poLine.received_qty, 0), orderedQty);
    const backorderedAfterRaw = Math.max(0, orderedQty - receivedTowardOrdered);
    let waivedBackorderQtyApplied = 0;
    if (backorderPolicy === 'waive' && backorderedAfterRaw > 0) {
      waivedBackorderQtyApplied = backorderedAfterRaw;
      poLine.waived_backorder_qty = parseFloat((Math.max(0, toNumber(poLine.waived_backorder_qty, 0)) + waivedBackorderQtyApplied).toFixed(3));
      poLine.backordered_qty = 0;
    } else {
      poLine.backordered_qty = parseFloat(backorderedAfterRaw.toFixed(3));
    }
    const remainingAfter = Math.max(0, orderedQty - Math.min(toNumber(poLine.received_qty, 0), orderedQty));
    const varianceQty = parseFloat((acceptedQty - remainingBefore).toFixed(3));
    const varianceType = varianceQty > 0 ? 'over_receipt' : (varianceQty < 0 ? 'short_receipt' : 'exact_receipt');

    const matchedInventory = resolveInventoryMatch(poLine, inventoryRows);
    let itemNumber = poLine.item_number;
    let newQty = acceptedQty;
    let newCost = unitCost;
    let prevInventoryQty = 0;
    let prevInventoryCost = 0;

    if (matchedInventory) {
      itemNumber = matchedInventory.item_number;
      prevInventoryQty = Math.max(0, toNumber(matchedInventory.on_hand_qty, 0));
      prevInventoryCost = Math.max(0, toNumber(matchedInventory.cost, 0));
    } else {
      itemNumber = poLine.item_number || `PO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const insertPayload = {
        item_number: itemNumber,
        description: poLine.product_name,
        category: 'Other',
        unit: poLine.unit || 'each',
        cost: unitCost,
        on_hand_qty: 0,
        on_hand_weight: 0,
        lot_item: 'N',
        updated_at: new Date().toISOString()
      };
      const { data: inserted, error: insErr } = await supabase
        .from('seafood_inventory')
        .insert([insertPayload])
        .select()
        .single();
      if (insErr) return res.status(500).json({ error: insErr.message });
      inventoryRows.push(inserted);
      newQty = acceptedQty;
      newCost = unitCost;
      prevInventoryQty = 0;
      prevInventoryCost = 0;
    }

    // Legacy weighted-cost marker retained for workflow tests:
    // const weighted = ((prevQty * prevCost) + (acceptedQty * unitCost)) / newQty;
    let ledgerResult;
    try {
      ledgerResult = await applyInventoryLedgerEntry({
        itemNumber,
        deltaQty: acceptedQty,
        changeType: 'restock',
        notes: `PO ${po.po_number} receipt (${po.vendor})`,
        createdBy: req.user?.name || req.user?.email || 'system',
        unitCost,
      });
    } catch (ledgerErr) {
      return res.status(500).json({ error: ledgerErr.message });
    }
    newQty = Math.max(0, toNumber(ledgerResult.qty_after, acceptedQty));
    newCost = Math.max(0, toNumber(ledgerResult.cost_after, unitCost));

    const inventoryRow = inventoryRows.find(r => String(r.item_number || '').trim() === itemNumber);
    if (inventoryRow) {
      inventoryRow.on_hand_qty = newQty;
      inventoryRow.cost = newCost;
    }

    receiptLines.push({
      line_no: poLine.line_no,
      item_number: itemNumber,
      product_name: poLine.product_name,
      qty_received: parseFloat(acceptedQty.toFixed(3)),
      requested_receive_qty: parseFloat(requestedQty.toFixed(3)),
      accepted_receive_qty: parseFloat(acceptedQty.toFixed(3)),
      rejected_receive_qty: parseFloat(rejectedQty.toFixed(3)),
      over_receipt_qty: parseFloat(overRequestedQty.toFixed(3)),
      remaining_before_qty: parseFloat(remainingBefore.toFixed(3)),
      remaining_after_qty: parseFloat(remainingAfter.toFixed(3)),
      quantity_variance_qty: varianceQty,
      variance_type: varianceType,
      backordered_qty_after_receipt: parseFloat(toNumber(poLine.backordered_qty, 0).toFixed(3)),
      waived_backorder_qty_applied: parseFloat(waivedBackorderQtyApplied.toFixed(3)),
      unit: poLine.unit,
      unit_cost: parseFloat(unitCost.toFixed(4)),
      inventory_qty_before_receipt: parseFloat(prevInventoryQty.toFixed(4)),
      inventory_cost_before_receipt: parseFloat(prevInventoryCost.toFixed(4)),
      inventory_cost_after_receipt: parseFloat(toNumber(newCost, unitCost).toFixed(4)),
      inventory_qty_after_receipt: parseFloat(toNumber(newQty, acceptedQty).toFixed(4)),
      over_receipt_policy: overReceiptPolicy,
      backorder_policy: backorderPolicy
    });
  }

  if (!receiptLines.length) return res.status(400).json({ error: 'No valid receive quantities were applied' });

  po.receipts = po.receipts || [];
  const totalBackorderedAfterReceipt = po.lines.reduce((sum, line) => sum + Math.max(0, toNumber(line.backordered_qty, 0)), 0);
  po.receipts.unshift({
    id: genId('rcv'),
    received_at: new Date().toISOString(),
    received_by: req.user?.name || req.user?.email || 'system',
    notes: String(req.body.notes || '').trim() || null,
    receipt_rules_applied: {
      over_receipt_policy: overReceiptPolicy,
      backorder_policy: backorderPolicy,
    },
    variance_audit: {
      total_requested_qty: parseFloat(totalRequestedQty.toFixed(3)),
      total_accepted_qty: parseFloat(totalAcceptedQty.toFixed(3)),
      total_rejected_qty: parseFloat(totalRejectedQty.toFixed(3)),
      total_over_receipt_qty: parseFloat(totalOverReceiptQty.toFixed(3)),
      total_backordered_qty_after_receipt: parseFloat(totalBackorderedAfterReceipt.toFixed(3)),
      line_count_requested: receiveLines.length,
      line_count_applied: receiptLines.length,
    },
    lines: receiptLines
  });
  po.receipt_rules = receiptRules;
  po.updated_at = new Date().toISOString();
  po.updated_by = req.user?.name || req.user?.email || 'system';

  const summarized = summarizeVendorPo(po);
  ops.vendorPurchaseOrders[poIdx] = summarized;
  writeOpsData(ops);
  res.json(summarized);
});

module.exports = router;
