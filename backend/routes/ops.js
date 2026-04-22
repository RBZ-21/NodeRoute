const express = require('express');
const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

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
    poDrafts: []
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

async function loadInventoryAndUsage(lookbackDays) {
  const lookbackStart = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: inventory, error: invErr }, { data: orders, error: ordErr }] = await Promise.all([
    supabase.from('seafood_inventory').select('*'),
    supabase.from('orders').select('items, created_at').gte('created_at', lookbackStart)
  ]);
  if (invErr) throw new Error(invErr.message);
  if (ordErr) throw new Error(ordErr.message);

  const usageByName = new Map();
  for (const order of orders || []) {
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

router.get('/uom-rules', authenticateToken, (req, res) => {
  const ops = readOpsData();
  res.json(ops.uomRules || []);
});

router.post('/uom-rules', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const { productName, fromUnit, toUnit, factor, notes } = req.body;
  if (!productName || !fromUnit || !toUnit) return res.status(400).json({ error: 'productName, fromUnit, and toUnit are required' });
  const parsedFactor = toNumber(factor, NaN);
  if (!Number.isFinite(parsedFactor) || parsedFactor <= 0) return res.status(400).json({ error: 'factor must be a positive number' });
  const ops = readOpsData();
  const rule = {
    id: genId('uom'),
    product_name: productName.trim(),
    from_unit: fromUnit.trim().toLowerCase(),
    to_unit: toUnit.trim().toLowerCase(),
    factor: parsedFactor,
    notes: (notes || '').trim(),
    created_at: new Date().toISOString()
  };
  ops.uomRules.unshift(rule);
  writeOpsData(ops);
  res.json(rule);
});

router.delete('/uom-rules/:id', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const ops = readOpsData();
  ops.uomRules = (ops.uomRules || []).filter(r => r.id !== req.params.id);
  writeOpsData(ops);
  res.json({ message: 'Rule deleted' });
});

router.get('/warehouses', authenticateToken, (req, res) => {
  const ops = readOpsData();
  res.json(ops.warehouses || []);
});

router.post('/warehouses', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const { name, code } = req.body;
  if (!name) return res.status(400).json({ error: 'Warehouse name required' });
  const ops = readOpsData();
  const wh = {
    id: genId('wh'),
    name: name.trim(),
    code: (code || name).toString().trim().toUpperCase().slice(0, 10),
    isDefault: false,
    created_at: new Date().toISOString()
  };
  ops.warehouses.push(wh);
  writeOpsData(ops);
  res.json(wh);
});

router.get('/cycle-counts', authenticateToken, (req, res) => {
  const ops = readOpsData();
  res.json(ops.cycleCounts || []);
});

router.post('/cycle-counts', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { warehouseId, countedItems, replaceStock } = req.body;
  if (!Array.isArray(countedItems) || countedItems.length === 0) return res.status(400).json({ error: 'countedItems is required' });

  const { data: inventory, error: invErr } = await supabase.from('seafood_inventory').select('*');
  if (invErr) return res.status(500).json({ error: invErr.message });

  const invById = new Map((inventory || []).map(i => [String(i.id), i]));
  const invByName = new Map((inventory || []).map(i => [String(i.name || i.description || '').toLowerCase(), i]));

  const normalized = countedItems.map(raw => {
    const countedQty = toNumber(raw.counted_qty ?? raw.countedQty, NaN);
    if (!Number.isFinite(countedQty)) return null;
    const product = raw.product_id ? invById.get(String(raw.product_id)) : invByName.get(String(raw.product_name || '').toLowerCase());
    const systemQty = toNumber(product?.stock_qty ?? product?.on_hand_qty, 0);
    return {
      product_id: product?.id || raw.product_id || null,
      product_name: product?.name || product?.description || raw.product_name || 'Unknown',
      system_qty: systemQty,
      counted_qty: countedQty,
      variance_qty: parseFloat((countedQty - systemQty).toFixed(3))
    };
  }).filter(Boolean);

  const countRecord = {
    id: genId('cc'),
    warehouse_id: warehouseId || 'wh-main',
    replace_stock: !!replaceStock,
    counted_at: new Date().toISOString(),
    lines: normalized
  };

  if (replaceStock) {
    for (const line of normalized) {
      if (!line.product_id) continue;
      await supabase.from('seafood_inventory').update({ on_hand_qty: line.counted_qty }).eq('id', line.product_id);
    }
  }

  const ops = readOpsData();
  ops.cycleCounts.unshift(countRecord);
  writeOpsData(ops);
  res.json(countRecord);
});

router.get('/returns', authenticateToken, (req, res) => {
  const ops = readOpsData();
  res.json(ops.returns || []);
});

router.post('/returns', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const { customerName, productName, quantity, reason, status } = req.body;
  if (!customerName || !productName) return res.status(400).json({ error: 'customerName and productName are required' });
  const qty = toNumber(quantity, 0);
  const ops = readOpsData();
  const ret = {
    id: genId('ret'),
    customer_name: customerName.trim(),
    product_name: productName.trim(),
    quantity: qty,
    reason: (reason || '').trim(),
    status: status || 'open',
    created_at: new Date().toISOString()
  };
  ops.returns.unshift(ret);
  writeOpsData(ops);
  res.json(ret);
});

router.get('/barcode-events', authenticateToken, (req, res) => {
  const ops = readOpsData();
  res.json((ops.barcodeEvents || []).slice(0, 200));
});

router.post('/barcode-events', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const { code, action, quantity, itemName, warehouseId } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  const ops = readOpsData();
  const event = {
    id: genId('scan'),
    code: String(code),
    action: action || 'scan',
    quantity: toNumber(quantity, 0),
    item_name: (itemName || '').trim(),
    warehouse_id: warehouseId || 'wh-main',
    created_at: new Date().toISOString(),
    user: req.user.name
  };
  ops.barcodeEvents.unshift(event);
  writeOpsData(ops);
  res.json(event);
});

router.get('/edi-jobs', authenticateToken, (req, res) => {
  const ops = readOpsData();
  res.json(ops.ediJobs || []);
});

router.post('/edi-jobs', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const { direction, partner, docType } = req.body;
  if (!direction || !partner || !docType) return res.status(400).json({ error: 'direction, partner, and docType are required' });
  const ops = readOpsData();
  const job = {
    id: genId('edi'),
    direction,
    partner,
    doc_type: docType,
    status: 'queued',
    created_at: new Date().toISOString()
  };
  ops.ediJobs.unshift(job);
  writeOpsData(ops);
  res.json(job);
});

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

router.get('/capabilities', authenticateToken, (req, res) => {
  res.json({
    catch_weight_management: true,
    lot_control_traceability: true,
    case_breaks_uom: true,
    inventory_projection_30_day: true,
    automated_purchasing: true,
    warehouse_barcode_android: true,
    realtime_inventory_mobile: true,
    multi_warehouse_cycle_count_returns: true,
    online_order_entry_edi_customer_portal: true
  });
});

module.exports = router;
