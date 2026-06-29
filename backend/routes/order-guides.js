'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../lib/zod-validate');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');

const router = express.Router();
const guideReaders = requireRole('admin', 'manager', 'rep');
const guideManagers = requireRole('admin', 'manager');

const idParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

const itemParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  itemId: z.string().trim().min(1, 'itemId is required'),
});

const guideQuerySchema = z.object({
  customerId: z.string().trim().min(1, 'customerId is required'),
});

const guideBodySchema = z.object({
  customer_id: z.string().trim().min(1, 'customer_id is required'),
  name: z.string().trim().min(1, 'name is required').max(160),
  is_active: z.boolean().optional().default(true),
  items: z.array(z.object({
    product_id: z.string().trim().min(1, 'product_id is required'),
    sort_order: z.coerce.number().int().min(0).optional().default(0),
    default_qty: z.coerce.number().min(0).optional().nullable(),
    default_uom: z.string().trim().max(50).optional().nullable(),
  })).max(500).optional().default([]),
});

const guidePatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  is_active: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one guide field is required',
});

const itemBodySchema = z.object({
  product_id: z.string().trim().min(1, 'product_id is required'),
  sort_order: z.coerce.number().int().min(0).optional().default(0),
  default_qty: z.coerce.number().min(0).optional().nullable(),
  default_uom: z.string().trim().max(50).optional().nullable(),
});

function scopedRows(rows, context) {
  return filterRowsByContext(rows || [], context);
}

async function loadGuideItems(guideIds, context) {
  const ids = (guideIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const { data, error } = await scopeQueryByContext(
    supabase.from('order_guide_items').select('*'),
    context,
  )
    .in('order_guide_id', ids)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  const grouped = new Map();
  for (const item of scopedRows(data, context).sort((a, b) => {
    const sortDelta = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    return sortDelta || String(a.id || '').localeCompare(String(b.id || ''));
  })) {
    const key = String(item.order_guide_id);
    const rows = grouped.get(key) || [];
    rows.push(item);
    grouped.set(key, rows);
  }
  return grouped;
}

async function loadGuides(customerId, context, { activeOnly = true } = {}) {
  let query = scopeQueryByContext(
    supabase.from('order_guides').select('*'),
    context,
  ).eq('customer_id', customerId);
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw error;
  const guides = scopedRows(data, context);
  const itemsByGuide = await loadGuideItems(guides.map((guide) => guide.id), context);
  return guides.map((guide) => ({
    ...guide,
    items: itemsByGuide.get(String(guide.id)) || [],
  }));
}

router.get('/', authenticateToken, guideReaders, validateQuery(guideQuerySchema), async (req, res) => {
  try {
    const guides = await loadGuides(req.validated.query.customerId, req.context, { activeOnly: true });
    res.json({ guides });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load order guides' });
  }
});

router.post('/', authenticateToken, guideManagers, validateBody(guideBodySchema), async (req, res) => {
  try {
    const body = req.validated.body;
    const guideResult = await insertRecordWithOptionalScope(supabase, 'order_guides', {
      customer_id: body.customer_id,
      name: body.name,
      is_active: body.is_active,
    }, req.context);
    if (guideResult.error) throw guideResult.error;

    const items = [];
    for (const item of body.items || []) {
      const itemResult = await insertRecordWithOptionalScope(supabase, 'order_guide_items', {
        order_guide_id: guideResult.data.id,
        product_id: item.product_id,
        sort_order: item.sort_order,
        default_qty: item.default_qty ?? null,
        default_uom: item.default_uom || null,
      }, req.context);
      if (itemResult.error) throw itemResult.error;
      items.push(itemResult.data);
    }

    res.status(201).json({ guide: { ...guideResult.data, items } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create order guide' });
  }
});

router.patch('/:id', authenticateToken, guideManagers, validateParams(idParamsSchema), validateBody(guidePatchSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('order_guides').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Order guide not found' });
    const itemsByGuide = await loadGuideItems([data.id], req.context);
    res.json({ guide: { ...data, items: itemsByGuide.get(String(data.id)) || [] } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update order guide' });
  }
});

router.post('/:id/items', authenticateToken, guideManagers, validateParams(idParamsSchema), validateBody(itemBodySchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'order_guide_items', {
      order_guide_id: req.validated.params.id,
      product_id: req.validated.body.product_id,
      sort_order: req.validated.body.sort_order,
      default_qty: req.validated.body.default_qty ?? null,
      default_uom: req.validated.body.default_uom || null,
    }, req.context);
    if (result.error) throw result.error;
    res.status(201).json({ item: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create order guide item' });
  }
});

router.patch('/:id/items/:itemId', authenticateToken, guideManagers, validateParams(itemParamsSchema), validateBody(itemBodySchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('order_guide_items').update({
        product_id: req.validated.body.product_id,
        sort_order: req.validated.body.sort_order,
        default_qty: req.validated.body.default_qty ?? null,
        default_uom: req.validated.body.default_uom || null,
      }),
      req.context,
    )
      .eq('order_guide_id', req.validated.params.id)
      .eq('id', req.validated.params.itemId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Order guide item not found' });
    res.json({ item: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update order guide item' });
  }
});

router.delete('/:id/items/:itemId', authenticateToken, guideManagers, validateParams(itemParamsSchema), async (req, res) => {
  try {
    const { error } = await scopeQueryByContext(
      supabase.from('order_guide_items').delete(),
      req.context,
    )
      .eq('order_guide_id', req.validated.params.id)
      .eq('id', req.validated.params.itemId);
    if (error) throw error;
    res.json({ deleted: true, id: req.validated.params.itemId });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete order guide item' });
  }
});

router.delete('/:id', authenticateToken, guideManagers, validateParams(idParamsSchema), async (req, res) => {
  try {
    const { error } = await scopeQueryByContext(
      supabase.from('order_guides').update({ is_active: false }),
      req.context,
    )
      .eq('id', req.validated.params.id);
    if (error) throw error;
    res.json({ deleted: true, id: req.validated.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete order guide' });
  }
});

module.exports = router;
module.exports.loadGuides = loadGuides;
