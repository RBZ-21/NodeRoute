'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateParams } = require('../lib/zod-validate');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');

const router = express.Router();

const countParamsSchema = z.object({ id: z.string().trim().min(1) });
const startCountSchema = z.object({
  product_ids: z.array(z.string().trim().min(1)).optional(),
  warehouse_location_id: z.string().trim().min(1).optional(),
}).passthrough();
const submitItemsSchema = z.object({
  items: z.array(z.object({
    id: z.string().trim().min(1),
    counted_qty: z.coerce.number().finite().min(0),
    notes: z.string().optional(),
  })).min(1),
}).passthrough();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundQty(value) {
  return Number(toNumber(value, 0).toFixed(4));
}

function isLotRequired(product) {
  return String(product?.lot_item || '').toUpperCase() === 'Y';
}

async function loadCount(countId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('cycle_counts').select('*'),
    context,
  )
    .eq('id', countId)
    .single();
  if (error || !data || !rowMatchesContext(data, context)) return null;
  return data;
}

async function loadCountItems(countId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('cycle_count_items').select('*'),
    context,
  )
    .eq('cycle_count_id', countId);
  if (error) throw error;
  return filterRowsByContext(data || [], context);
}

async function loadProductsForSnapshot(productIds, context) {
  let query = scopeQueryByContext(supabase.from('products').select('*'), context);
  if (Array.isArray(productIds) && productIds.length) query = query.in('id', productIds);
  const { data, error } = await query;
  if (error) throw error;
  return filterRowsByContext(data || [], context);
}

async function enrichItemsWithProducts(items, context) {
  const ids = [...new Set((items || []).map((item) => item.product_id).filter(Boolean))];
  if (!ids.length) return { productsById: new Map() };
  const { data, error } = await scopeQueryByContext(
    supabase.from('products').select('*'),
    context,
  )
    .in('id', ids);
  if (error) throw error;
  return {
    productsById: new Map(filterRowsByContext(data || [], context).map((product) => [String(product.id), product])),
  };
}

router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(startCountSchema), async (req, res) => {
  try {
    const products = await loadProductsForSnapshot(req.validated.body.product_ids, req.context);
    if (!products.length) return res.status(400).json({ error: 'No products found for cycle count' });

    const countResult = await insertRecordWithOptionalScope(supabase, 'cycle_counts', {
      status: 'open',
      started_by: req.user.id || null,
      started_at: new Date().toISOString(),
    }, req.context);
    if (countResult.error) return res.status(500).json({ error: countResult.error.message });

    const scopeFields = buildScopeFields(req.context);
    const rows = products.map((product) => ({
      id: `cycle-item-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      cycle_count_id: countResult.data.id,
      product_id: product.id,
      lot_id: null,
      warehouse_location_id: req.validated.body.warehouse_location_id || null,
      expected_qty: roundQty(product.on_hand_qty ?? product.on_hand_quantity),
      counted_qty: null,
      variance_qty: null,
      notes: null,
      ...scopeFields,
    }));
    const { data: items, error: itemError } = await supabase.from('cycle_count_items').insert(rows).select();
    if (itemError) return res.status(500).json({ error: itemError.message });

    res.status(201).json({ ...countResult.data, items: items || rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticateToken, validateParams(countParamsSchema), async (req, res) => {
  try {
    const count = await loadCount(req.validated.params.id, req.context);
    if (!count) return res.status(404).json({ error: 'Cycle count not found' });
    const items = await loadCountItems(count.id, req.context);
    res.json({ ...count, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/items', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateParams(countParamsSchema), validateBody(submitItemsSchema), async (req, res) => {
  try {
    const count = await loadCount(req.validated.params.id, req.context);
    if (!count) return res.status(404).json({ error: 'Cycle count not found' });
    if (count.status === 'completed') return res.status(400).json({ error: 'Cycle count is already completed' });

    const updated = [];
    for (const item of req.validated.body.items) {
      const { data, error } = await scopeQueryByContext(
        supabase.from('cycle_count_items').update({
          counted_qty: roundQty(item.counted_qty),
          notes: item.notes || null,
        }),
        req.context,
      )
        .eq('id', item.id)
        .eq('cycle_count_id', count.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      if (data) updated.push(data);
    }
    await scopeQueryByContext(supabase.from('cycle_counts').update({ status: 'submitted' }), req.context).eq('id', count.id);
    res.json({ updated: updated.length, items: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/commit', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateParams(countParamsSchema), async (req, res) => {
  try {
    const count = await loadCount(req.validated.params.id, req.context);
    if (!count) return res.status(404).json({ error: 'Cycle count not found' });
    if (count.status === 'completed') return res.status(400).json({ error: 'Cycle count is already completed' });

    const items = await loadCountItems(count.id, req.context);
    const missing = items.find((item) => item.counted_qty === null || item.counted_qty === undefined);
    if (missing) return res.status(400).json({ error: 'All count items must have counted_qty before commit' });

    const { productsById } = await enrichItemsWithProducts(items, req.context);
    const committedItems = [];
    for (const item of items) {
      const product = productsById.get(String(item.product_id));
      if (!product) continue;
      const variance = roundQty(toNumber(item.counted_qty) - toNumber(item.expected_qty));
      if (variance < 0 && isLotRequired(product) && !item.lot_id) {
        return res.status(422).json({ error: `${product.description || product.name || product.item_number} requires a lot for negative count variance`, requires_lot: true });
      }

      const { data: updatedItem, error: updateError } = await scopeQueryByContext(
        supabase.from('cycle_count_items').update({ variance_qty: variance }),
        req.context,
      )
        .eq('id', item.id)
        .select()
        .single();
      if (updateError) return res.status(500).json({ error: updateError.message });
      committedItems.push(updatedItem || { ...item, variance_qty: variance });

      if (variance !== 0) {
        await applyInventoryLedgerEntry({
          itemNumber: product.item_number,
          deltaQty: variance,
          changeType: 'cycle_count',
          notes: item.notes || `Cycle count ${count.id}`,
          createdBy: req.user.name || req.user.email,
          lotId: item.lot_id || null,
          context: req.context,
        });
      }
    }

    const { data: completed, error: completeError } = await scopeQueryByContext(
      supabase.from('cycle_counts').update({ status: 'completed', completed_at: new Date().toISOString() }),
      req.context,
    )
      .eq('id', count.id)
      .select()
      .single();
    if (completeError) return res.status(500).json({ error: completeError.message });

    res.json({ ...(completed || count), status: 'completed', items: committedItems });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
