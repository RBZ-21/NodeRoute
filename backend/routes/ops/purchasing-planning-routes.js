const express = require('express');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const {
  buildProjectionRows,
  buildPurchasingSuggestions,
  genId,
  loadInventoryAndUsage,
  normalizeIntakeQuantity,
  normalizeUnit,
  readOpsData,
  resolveInventoryMatch,
  toNumber,
  writeOpsData,
} = require('./purchasing-shared');

module.exports = function buildOpsPurchasingPlanningRouter() {
  const router = express.Router();

  router.get('/projections', authenticateToken, async (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days || '30', 10)));
    const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));
    try {
      const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
      const projections = buildProjectionRows(inventory, usageByName, { days, lookbackDays });
      res.json({ days, lookbackDays, generated_at: new Date().toISOString(), projections });
    } catch (error) {
      res.status(500).json({ error: error.message });
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
    } catch (error) {
      res.status(500).json({ error: error.message });
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
      ? new Set(req.body.includeUrgencies.map((value) => String(value).toLowerCase()))
      : new Set(['high', 'normal']);

    try {
      const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
      const suggestions = buildPurchasingSuggestions(inventory, usageByName, { coverageDays, leadTimeDays, lookbackDays });
      const urgencyRank = { high: 0, normal: 1, none: 2 };
      const selected = suggestions
        .filter((suggestion) => includedUrgencies.has(String(suggestion.urgency || '').toLowerCase()) && suggestion.suggested_order_qty > minOrderQty)
        .sort((a, b) => (urgencyRank[a.urgency] - urgencyRank[b.urgency]) || (b.suggested_order_qty - a.suggested_order_qty))
        .slice(0, maxLines);

      if (!selected.length) {
        return res.status(400).json({ error: 'No reorder suggestions matched the draft filters' });
      }

      const nowIso = new Date().toISOString();
      const lines = selected.map((suggestion, index) => {
        const unitCost = toNumber(suggestion.estimated_unit_cost, 0);
        const qty = toNumber(suggestion.suggested_order_qty, 0);
        return {
          line_no: index + 1,
          product_id: suggestion.product_id || null,
          product_name: suggestion.product_name,
          unit: suggestion.unit,
          quantity: parseFloat(qty.toFixed(3)),
          estimated_unit_cost: parseFloat(unitCost.toFixed(4)),
          estimated_line_total: parseFloat((qty * unitCost).toFixed(2)),
          urgency: suggestion.urgency,
          stock_qty: suggestion.stock_qty,
          avg_daily_usage: suggestion.avg_daily_usage,
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
        total_suggested_qty: parseFloat(lines.reduce((sum, line) => sum + toNumber(line.quantity, 0), 0).toFixed(3)),
        total_estimated_cost: parseFloat(lines.reduce((sum, line) => sum + toNumber(line.estimated_line_total, 0), 0).toFixed(2)),
        created_by: req.user?.name || req.user?.email || 'system',
        created_at: nowIso,
        updated_at: nowIso,
      };

      const ops = readOpsData();
      ops.poDrafts = ops.poDrafts || [];
      ops.poDrafts.unshift(draft);
      writeOpsData(ops);
      res.json(draft);
    } catch (error) {
      res.status(500).json({ error: error.message });
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
          match_status: matched ? 'matched' : 'unmatched',
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
      const lines = selected.map((selection, index) => {
        const qty = toNumber(selection.suggested_order_qty, 0);
        const unitCost = toNumber(selection.estimated_unit_cost, 0);
        return {
          line_no: index + 1,
          product_id: selection.product_id,
          item_number: selection.item_number,
          product_name: selection.product_name,
          unit: selection.unit,
          quantity: parseFloat(qty.toFixed(3)),
          estimated_unit_cost: parseFloat(unitCost.toFixed(4)),
          estimated_line_total: parseFloat((qty * unitCost).toFixed(2)),
          urgency: selection.urgency,
          match_status: selection.match_status,
          requested_intake_qty: selection.requested_intake_qty,
          stock_qty: selection.stock_qty,
          stock_gap_qty: selection.stock_gap_qty,
          avg_daily_usage: selection.avg_daily_usage,
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
          intake_message_excerpt: String(req.body.intakeMessage || '').trim().slice(0, 200) || null,
        },
        lines,
        line_count: lines.length,
        total_suggested_qty: parseFloat(lines.reduce((sum, line) => sum + toNumber(line.quantity, 0), 0).toFixed(3)),
        total_estimated_cost: parseFloat(lines.reduce((sum, line) => sum + toNumber(line.estimated_line_total, 0), 0).toFixed(2)),
        created_by: req.user?.name || req.user?.email || 'system',
        created_at: nowIso,
        updated_at: nowIso,
      };

      const ops = readOpsData();
      ops.poDrafts = ops.poDrafts || [];
      ops.poDrafts.unshift(draft);
      writeOpsData(ops);
      res.json(draft);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/purchase-order-drafts/:id/status', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const allowed = new Set(['draft', 'ready', 'ordered', 'archived']);
    const nextStatus = String(req.body.status || '').toLowerCase();
    if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'Invalid status' });

    const ops = readOpsData();
    ops.poDrafts = ops.poDrafts || [];
    const index = ops.poDrafts.findIndex((draft) => draft.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Draft not found' });

    const current = ops.poDrafts[index];
    const updated = {
      ...current,
      status: nextStatus,
      updated_at: new Date().toISOString(),
      updated_by: req.user?.name || req.user?.email || 'system',
    };
    ops.poDrafts[index] = updated;
    writeOpsData(ops);
    res.json(updated);
  });

  return router;
};
