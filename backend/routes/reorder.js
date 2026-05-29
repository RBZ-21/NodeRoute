'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../lib/zod-validate');
const {
  insertRecordWithOptionalScope,
  filterRowsByContext,
  rowMatchesContext,
  buildScopeFields,
  scopeQueryByContext,
} = require('../services/operating-context');
const { generatePurchaseOrderNumber } = require('../services/purchase-order-numbers');
const reorderEngine = require('../services/reorderEngine');

const router = express.Router();

const dismissSchema = z.object({ reason: z.string().trim().min(1, 'reason is required') });
const snoozeSchema = z.object({ snooze_until: z.string().datetime('snooze_until must be an ISO date') });
const settingsSchema = z.object({
  reorder_enabled: z.boolean().optional(),
  reorder_point: z.coerce.number().nonnegative().optional(),
  reorder_quantity: z.coerce.number().nonnegative().optional(),
  safety_stock: z.coerce.number().nonnegative().optional(),
  lead_time_days: z.coerce.number().int().min(1).max(365).optional(),
  min_order_quantity: z.coerce.number().positive().optional(),
  max_stock_level: z.coerce.number().nonnegative().optional(),
  avg_daily_usage: z.coerce.number().nonnegative().optional(),
  usage_trend: z.enum(['rising', 'falling', 'stable', 'seasonal']).optional(),
  preferred_vendor_id: z.string().uuid().nullable().optional(),
}).strict();

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentUserId(req) {
  return req.user?.id || req.user?.email || req.user?.name || 'system';
}

async function fetchSuggestion(id, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('reorder_suggestions').select('*'),
    context
  ).eq('id', id).single();
  if (error || !data) return { error: error || new Error('Suggestion not found'), status: 404 };
  if (!rowMatchesContext(data, context)) return { error: new Error('Forbidden'), status: 403 };
  return { data };
}

async function enrichSuggestions(rows, context) {
  const productIds = [...new Set((rows || []).map((row) => row.product_id).filter(Boolean))];
  const vendorIds = [...new Set((rows || []).map((row) => row.vendor_id).filter(Boolean))];
  const productMap = new Map();
  const vendorMap = new Map();

  if (productIds.length) {
    const { data: products } = await scopeQueryByContext(
      supabase.from('products').select('id,item_number,name,description,category,unit,default_unit,on_hand_qty,reorder_point,safety_stock,lead_time_days,min_order_quantity,max_stock_level,avg_daily_usage,usage_trend,reorder_enabled,preferred_vendor_id,company_id,location_id'),
      context
    ).in('id', productIds);
    (products || []).forEach((product) => productMap.set(product.id, product));
  }
  if (vendorIds.length) {
    const { data: vendors } = await scopeQueryByContext(
      supabase.from('vendors').select('id,name,email,phone,contact,payment_terms'),
      context
    ).in('id', vendorIds);
    (vendors || []).forEach((vendor) => vendorMap.set(vendor.id, vendor));
  }

  return (rows || []).map((row) => ({
    ...row,
    product: productMap.get(row.product_id) || null,
    vendor: vendorMap.get(row.vendor_id) || null,
  }));
}

function sortSuggestions(rows, sort) {
  const urgencyRank = { critical: 0, urgent: 1, scheduled: 2, normal: 3 };
  const sorted = [...rows];
  if (sort === 'days_remaining') {
    sorted.sort((a, b) => toNumber(a.days_of_stock_remaining, 9999) - toNumber(b.days_of_stock_remaining, 9999));
  } else if (sort === 'product') {
    sorted.sort((a, b) => String(a.product?.name || a.product?.description || '').localeCompare(String(b.product?.name || b.product?.description || '')));
  } else {
    sorted.sort((a, b) => (urgencyRank[a.urgency] ?? 9) - (urgencyRank[b.urgency] ?? 9) || toNumber(a.days_of_stock_remaining, 9999) - toNumber(b.days_of_stock_remaining, 9999));
  }
  return sorted;
}

router.get('/suggestions', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const status = String(req.query.status || 'pending').trim();
    let query = scopeQueryByContext(
      supabase.from('reorder_suggestions').select('*'),
      req.context
    ).order('created_at', { ascending: false });
    if (status && status !== 'all') query = query.eq('status', status);
    if (req.query.urgency) query = query.eq('urgency', String(req.query.urgency));
    if (req.query.vendor_id) query = query.eq('vendor_id', String(req.query.vendor_id));
    if (req.query.product_id) query = query.eq('product_id', String(req.query.product_id));

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const visible = filterRowsByContext(data || [], req.context)
      .filter((row) => !row.snoozed_until || new Date(row.snoozed_until).getTime() <= Date.now() || row.status !== 'snoozed');
    const enriched = await enrichSuggestions(visible, req.context);
    res.json(sortSuggestions(enriched, String(req.query.sort || 'urgency')));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load reorder suggestions' });
  }
});

router.get('/suggestions/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const result = await fetchSuggestion(req.params.id, req.context);
    if (result.error) return res.status(result.status).json({ error: result.error.message });
    const [enriched] = await enrichSuggestions([result.data], req.context);
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load reorder suggestion' });
  }
});

router.patch('/suggestions/:id/approve', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const result = await fetchSuggestion(req.params.id, req.context);
    if (result.error) return res.status(result.status).json({ error: result.error.message });
    const suggestion = result.data;
    if (suggestion.status !== 'pending' && suggestion.status !== 'snoozed') {
      return res.status(409).json({ error: `Suggestion is already ${suggestion.status}` });
    }
    if (!suggestion.vendor_id) {
      return res.status(422).json({ error: 'Suggestion has no vendor_id. Assign a product preferred vendor before approving.' });
    }

    const [enriched] = await enrichSuggestions([suggestion], req.context);
    const product = enriched.product || {};
    const vendor = enriched.vendor || {};
    const unit = suggestion.suggested_unit || product.unit || product.default_unit || 'units';
    const description = `Auto-reorder: ${product.name || product.description || product.item_number} - triggered by low stock (${suggestion.current_stock} ${unit} remaining, ${suggestion.days_of_stock_remaining ?? 'unknown'} days until stockout)`;
    const quantity = toNumber(suggestion.suggested_quantity, 0);
    const unitCost = toNumber(product.cost, 0);
    const poPayload = {
      po_number: await generatePurchaseOrderNumber(),
      vendor: vendor.name || null,
      vendor_id: suggestion.vendor_id,
      items: [{
        product_id: product.id || suggestion.product_id,
        item_number: product.item_number || null,
        description,
        quantity,
        unit,
        unit_price: unitCost,
        total: Number((quantity * unitCost).toFixed(2)),
        reorder_suggestion_id: suggestion.id,
      }],
      total_cost: Number((quantity * unitCost).toFixed(2)),
      notes: suggestion.reason,
      status: 'draft',
      workflow_kind: 'vendor_order',
      workflow_id: `reorder-${suggestion.id}`,
      suggestion_id: suggestion.id,
      created_by: currentUserId(req),
      updated_by: currentUserId(req),
      updated_at: new Date().toISOString(),
      ...buildScopeFields(req.context, {
        company_id: suggestion.company_id || product.company_id || undefined,
        location_id: suggestion.location_id || product.location_id || undefined,
      }),
    };

    const poInsert = await insertRecordWithOptionalScope(supabase, 'purchase_orders', poPayload, req.context);
    if (poInsert.error) return res.status(500).json({ error: poInsert.error.message });

    const update = await scopeQueryByContext(
      supabase.from('reorder_suggestions').update({
        status: 'converted_to_po',
        approved_by: currentUserId(req),
        approved_at: new Date().toISOString(),
        po_id: poInsert.data?.id || null,
      }),
      req.context
    )
      .eq('id', suggestion.id)
      .select()
      .single();
    if (update.error) return res.status(500).json({ error: update.error.message });
    res.json({ suggestion: update.data, purchase_order: poInsert.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not approve reorder suggestion' });
  }
});

router.patch('/suggestions/:id/dismiss', authenticateToken, requireRole('admin', 'manager'), validateBody(dismissSchema), async (req, res) => {
  try {
    const result = await fetchSuggestion(req.params.id, req.context);
    if (result.error) return res.status(result.status).json({ error: result.error.message });
    const { data, error } = await scopeQueryByContext(
      supabase.from('reorder_suggestions').update({
        status: 'dismissed',
        dismissed_by: currentUserId(req),
        dismissed_at: new Date().toISOString(),
        dismiss_reason: req.validated.body.reason,
      }),
      req.context
    )
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not dismiss reorder suggestion' });
  }
});

router.patch('/suggestions/:id/snooze', authenticateToken, requireRole('admin', 'manager'), validateBody(snoozeSchema), async (req, res) => {
  try {
    const result = await fetchSuggestion(req.params.id, req.context);
    if (result.error) return res.status(result.status).json({ error: result.error.message });
    const { data, error } = await scopeQueryByContext(
      supabase.from('reorder_suggestions').update({ status: 'snoozed', snoozed_until: req.validated.body.snooze_until }),
      req.context
    )
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not snooze reorder suggestion' });
  }
});

router.post('/run-check', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await reorderEngine.runReorderCheck({ context: req.context });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not run reorder check' });
  }
});

router.get('/product/:product_id/settings', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data: product, error } = await scopeQueryByContext(
      supabase.from('products').select('*'),
      req.context
    ).eq('id', req.params.product_id).single();
    if (error || !product) return res.status(404).json({ error: 'Product not found' });
    if (!rowMatchesContext(product, req.context)) return res.status(403).json({ error: 'Forbidden' });
    const calculation = await reorderEngine.calculateSuggestedQuantity(product.id).catch((err) => ({ error: err.message }));
    res.json({
      product_id: product.id,
      product_name: product.name || product.description,
      reorder_enabled: product.reorder_enabled,
      reorder_point: product.reorder_point,
      reorder_quantity: product.reorder_quantity,
      safety_stock: product.safety_stock,
      lead_time_days: product.lead_time_days,
      min_order_quantity: product.min_order_quantity,
      max_stock_level: product.max_stock_level,
      avg_daily_usage: product.avg_daily_usage,
      usage_trend: product.usage_trend,
      preferred_vendor_id: product.preferred_vendor_id || null,
      last_reorder_calc_at: product.last_reorder_calc_at,
      system_calculated: calculation,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load reorder settings' });
  }
});

router.patch('/product/:product_id/settings', authenticateToken, requireRole('admin', 'manager'), validateBody(settingsSchema), async (req, res) => {
  try {
    const { data: before, error: beforeErr } = await scopeQueryByContext(
      supabase.from('products').select('*'),
      req.context
    ).eq('id', req.params.product_id).single();
    if (beforeErr || !before) return res.status(404).json({ error: 'Product not found' });
    if (!rowMatchesContext(before, req.context)) return res.status(403).json({ error: 'Forbidden' });

    const fields = { ...req.validated.body, updated_at: new Date().toISOString() };
    const { data: after, error } = await scopeQueryByContext(
      supabase.from('products').update(fields),
      req.context
    )
      .eq('id', before.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await insertRecordWithOptionalScope(supabase, 'reorder_settings_audit', {
      product_id: before.id,
      changed_by: currentUserId(req),
      before_values: before,
      after_values: fields,
    }, req.context);

    res.json(after);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not update reorder settings' });
  }
});

router.get('/dashboard', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('reorder_suggestions').select('*'),
      req.context
    ).eq('status', 'pending');
    if (error) return res.status(500).json({ error: error.message });
    const pending = filterRowsByContext(data || [], req.context);
    const critical = pending.filter((row) => row.urgency === 'critical');
    const urgent = pending.filter((row) => row.urgency === 'urgent' || row.urgency === 'scheduled');
    const normal = pending.filter((row) => row.urgency === 'normal');
    const enrichedRisk = await enrichSuggestions(
      pending
        .filter((row) => row.days_of_stock_remaining !== null && toNumber(row.days_of_stock_remaining, 999) <= 2)
        .sort((a, b) => toNumber(a.days_of_stock_remaining, 999) - toNumber(b.days_of_stock_remaining, 999))
        .slice(0, 10),
      req.context
    );

    res.json({
      critical_count: critical.length,
      urgent_count: urgent.length,
      normal_count: normal.length,
      total_pending: pending.length,
      stockout_risk: enrichedRisk.map((row) => ({
        product_name: row.product?.name || row.product?.description || row.product_id,
        days_remaining: row.days_of_stock_remaining,
        current_stock: row.current_stock,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load reorder dashboard' });
  }
});

module.exports = router;
