const express = require('express');
const { supabase } = require('../../services/supabase');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../../services/operating-context');
const {
  buildProjectionRows,
  buildPurchasingSuggestions,
  loadInventoryAndUsage,
  loadVendorPurchaseOrdersForContext,
  normalizeIntakeQuantity,
  normalizeUnit,
  resolveHistoricalLeadTimeDays,
  resolveInventoryMatch,
  summarizeVendorPurchaseOrders,
  toNumber,
} = require('./purchasing-shared');

function mapDraftRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    draft_number: row.draft_number,
    status: row.status,
    vendor: row.vendor,
    notes: row.notes || null,
    source: row.source || {},
    lines: Array.isArray(row.lines) ? row.lines : [],
    line_count: row.line_count || (Array.isArray(row.lines) ? row.lines.length : 0),
    total_suggested_qty: row.total_suggested_qty,
    total_estimated_cost: row.total_estimated_cost,
    linked_vendor_po_id: row.linked_vendor_po_id || null,
    created_by: row.created_by || 'system',
    updated_by: row.updated_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildDraftNumber() {
  return `DRAFT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

module.exports = function buildOpsPurchasingPlanningRouter() {
  const router = express.Router();

  function resolveLeadTimeForInventoryItem(orders, vendor, item) {
    return resolveHistoricalLeadTimeDays(orders, vendor, {
      item_number: item?.item_number || item?.product_id,
      product_name: item?.name || item?.description || item?.product_name,
    });
  }

  router.get('/projections', authenticateToken, async (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days || '30', 10)));
    const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));
    try {
      const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays, req.context);
      const projections = buildProjectionRows(inventory, usageByName, { days, lookbackDays });
      res.json({ days, lookbackDays, generated_at: new Date().toISOString(), projections });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/purchasing-suggestions', authenticateToken, async (req, res) => {
    const coverageDays = Math.max(1, Math.min(90, parseInt(req.query.coverageDays || '30', 10)));
    const manualLeadTimeRaw = req.query.leadTimeDays;
    const vendor = String(req.query.vendor || '').trim();
    const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));
    try {
      const summarizedOrders = await loadVendorPurchaseOrdersForContext(req.context);
      const resolvedLead = manualLeadTimeRaw !== undefined && String(manualLeadTimeRaw).trim() !== ''
        ? {
            leadTimeDays: Math.max(0, Math.min(60, parseInt(manualLeadTimeRaw, 10) || 0)),
            source: 'manual',
            history: resolveHistoricalLeadTimeDays(summarizedOrders, vendor).history,
          }
        : resolveHistoricalLeadTimeDays(summarizedOrders, vendor);
      const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays, req.context);
      const suggestions = buildPurchasingSuggestions(inventory, usageByName, {
        coverageDays,
        leadTimeDays: resolvedLead.leadTimeDays,
        lookbackDays,
        leadTimeResolver: manualLeadTimeRaw !== undefined && String(manualLeadTimeRaw).trim() !== ''
          ? null
          : (item) => resolveLeadTimeForInventoryItem(summarizedOrders, vendor, item),
      });
      res.json({
        leadTimeDays: resolvedLead.leadTimeDays,
        leadTimeSource: resolvedLead.source,
        historicalLeadTime: resolvedLead.history,
        coverageDays,
        lookbackDays,
        generated_at: new Date().toISOString(),
        suggestions,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/purchase-order-drafts', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('op_po_drafts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context).map(mapDraftRow));
  });

  router.post('/purchase-order-drafts/from-suggestions', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const coverageDays = Math.max(1, Math.min(90, parseInt(req.body.coverageDays || '30', 10)));
    const manualLeadTimeRaw = req.body.leadTimeDays;
    const lookbackDays = Math.max(7, Math.min(90, parseInt(req.body.lookbackDays || '30', 10)));
    const minOrderQty = Math.max(0, toNumber(req.body.minOrderQty, 0));
    const maxLines = Math.max(1, Math.min(200, parseInt(req.body.maxLines || '50', 10)));
    const vendor = String(req.body.vendor || '').trim() || 'Unassigned Vendor';
    const notes = String(req.body.notes || '').trim();
    const includedUrgencies = Array.isArray(req.body.includeUrgencies) && req.body.includeUrgencies.length
      ? new Set(req.body.includeUrgencies.map((value) => String(value).toLowerCase()))
      : new Set(['high', 'normal']);

    try {
      const summarizedOrders = await loadVendorPurchaseOrdersForContext(req.context);
      const resolvedLead = manualLeadTimeRaw !== undefined && String(manualLeadTimeRaw).trim() !== ''
        ? {
            leadTimeDays: Math.max(0, Math.min(60, parseInt(manualLeadTimeRaw, 10) || 0)),
            source: 'manual',
            history: resolveHistoricalLeadTimeDays(summarizedOrders, vendor).history,
          }
        : resolveHistoricalLeadTimeDays(summarizedOrders, vendor);
      const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays, req.context);
      const suggestions = buildPurchasingSuggestions(inventory, usageByName, {
        coverageDays,
        leadTimeDays: resolvedLead.leadTimeDays,
        lookbackDays,
        leadTimeResolver: manualLeadTimeRaw !== undefined && String(manualLeadTimeRaw).trim() !== ''
          ? null
          : (item) => resolveLeadTimeForInventoryItem(summarizedOrders, vendor, item),
      });
      const urgencyRank = { high: 0, normal: 1, none: 2 };
      const selected = suggestions
        .filter((suggestion) => includedUrgencies.has(String(suggestion.urgency || '').toLowerCase()) && suggestion.suggested_order_qty > minOrderQty)
        .sort((a, b) => (urgencyRank[a.urgency] - urgencyRank[b.urgency]) || (b.suggested_order_qty - a.suggested_order_qty))
        .slice(0, maxLines);

      if (!selected.length) {
        return res.status(400).json({ error: 'No reorder suggestions matched the draft filters' });
      }

      const lines = selected.map((suggestion, index) => {
        const unitCost = toNumber(suggestion.estimated_unit_cost, 0);
        const qty = toNumber(suggestion.suggested_order_qty, 0);
        return {
          line_no: index + 1,
          product_id: suggestion.product_id || null,
          item_number: suggestion.item_number || null,
          product_name: suggestion.product_name,
          unit: suggestion.unit,
          quantity: parseFloat(qty.toFixed(3)),
          estimated_unit_cost: parseFloat(unitCost.toFixed(4)),
          estimated_line_total: parseFloat((qty * unitCost).toFixed(2)),
          lead_time_days: suggestion.lead_time_days,
          lead_time_source: suggestion.lead_time_source,
          historical_lead_time: suggestion.historical_lead_time || null,
          urgency: suggestion.urgency,
          stock_qty: suggestion.stock_qty,
          avg_daily_usage: suggestion.avg_daily_usage,
        };
      });

      const totalSuggestedQty = parseFloat(lines.reduce((sum, line) => sum + toNumber(line.quantity, 0), 0).toFixed(3));
      const totalEstimatedCost = parseFloat(lines.reduce((sum, line) => sum + toNumber(line.estimated_line_total, 0), 0).toFixed(2));

      const insertResult = await insertRecordWithOptionalScope(supabase, 'op_po_drafts', {
        draft_number: buildDraftNumber(),
        status: 'draft',
        vendor,
        notes: notes || null,
        source: {
          coverageDays,
          leadTimeDays: resolvedLead.leadTimeDays,
          leadTimeSource: resolvedLead.source,
          historicalLeadTime: resolvedLead.history,
          lookbackDays,
          minOrderQty,
          maxLines,
        },
        lines,
        line_count: lines.length,
        total_suggested_qty: totalSuggestedQty,
        total_estimated_cost: totalEstimatedCost,
        created_by: req.user?.name || req.user?.email || 'system',
      }, req.context);
      if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
      res.json(mapDraftRow(insertResult.data));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/purchase-order-drafts/from-order-intake', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const intakeItems = Array.isArray(req.body.intakeItems) ? req.body.intakeItems : [];
    if (!intakeItems.length) return res.status(400).json({ error: 'intakeItems is required' });

    const manualLeadTimeRaw = req.body.leadTimeDays;
    const lookbackDays = Math.max(7, Math.min(90, parseInt(req.body.lookbackDays || '30', 10)));
    const minOrderQty = Math.max(0, toNumber(req.body.minOrderQty, 0));
    const maxLines = Math.max(1, Math.min(200, parseInt(req.body.maxLines || '50', 10)));
    const vendor = String(req.body.vendor || '').trim() || 'Unassigned Vendor';
    const notes = String(req.body.notes || '').trim();

    try {
      const summarizedOrders = await loadVendorPurchaseOrdersForContext(req.context);
      const resolvedLead = manualLeadTimeRaw !== undefined && String(manualLeadTimeRaw).trim() !== ''
        ? {
            leadTimeDays: Math.max(0, Math.min(60, parseInt(manualLeadTimeRaw, 10) || 0)),
            source: 'manual',
            history: resolveHistoricalLeadTimeDays(summarizedOrders, vendor).history,
          }
        : resolveHistoricalLeadTimeDays(summarizedOrders, vendor);
      const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays, req.context);
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
        const itemLead = manualLeadTimeRaw !== undefined && String(manualLeadTimeRaw).trim() !== ''
          ? {
              leadTimeDays: resolvedLead.leadTimeDays,
              source: 'manual',
              history: resolvedLead.history,
            }
          : resolveHistoricalLeadTimeDays(summarizedOrders, vendor, {
              item_number: matched?.item_number || item.item_number,
              product_name: matchedName || item.name,
            });
        const leadBuffer = Math.max(0, avgDaily * itemLead.leadTimeDays);
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
          lead_time_days: itemLead.leadTimeDays,
          lead_time_source: itemLead.source,
          historical_lead_time: itemLead.history || null,
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
          lead_time_days: selection.lead_time_days,
          lead_time_source: selection.lead_time_source,
          historical_lead_time: selection.historical_lead_time || null,
        };
      });

      const totalSuggestedQty = parseFloat(lines.reduce((sum, line) => sum + toNumber(line.quantity, 0), 0).toFixed(3));
      const totalEstimatedCost = parseFloat(lines.reduce((sum, line) => sum + toNumber(line.estimated_line_total, 0), 0).toFixed(2));

      const insertResult = await insertRecordWithOptionalScope(supabase, 'op_po_drafts', {
        draft_number: buildDraftNumber(),
        status: 'draft',
        vendor,
        notes: notes || null,
        source: {
          mode: 'order_intake',
          leadTimeDays: resolvedLead.leadTimeDays,
          leadTimeSource: resolvedLead.source,
          historicalLeadTime: resolvedLead.history,
          lookbackDays,
          minOrderQty,
          maxLines,
          intake_item_count: normalizedIntake.length,
          intake_message_excerpt: String(req.body.intakeMessage || '').trim().slice(0, 200) || null,
        },
        lines,
        line_count: lines.length,
        total_suggested_qty: totalSuggestedQty,
        total_estimated_cost: totalEstimatedCost,
        created_by: req.user?.name || req.user?.email || 'system',
      }, req.context);
      if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
      res.json(mapDraftRow(insertResult.data));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/purchase-order-drafts/:id/status', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const allowed = new Set(['draft', 'ready', 'ordered', 'archived']);
    const nextStatus = String(req.body.status || '').toLowerCase();
    if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'Invalid status' });

    const { data: existing, error: fetchErr } = await supabase
      .from('op_po_drafts').select('*').eq('id', req.params.id).single();
    if (fetchErr) return res.status(404).json({ error: 'Draft not found' });
    if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await supabase
      .from('op_po_drafts')
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
        updated_by: req.user?.name || req.user?.email || 'system',
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(mapDraftRow(data));
  });

  return router;
};
