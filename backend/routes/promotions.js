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
const promotionReaders = requireRole('admin', 'manager', 'rep');
const promotionManagers = requireRole('admin', 'manager');

const promoTypes = ['sale_price', 'percent_off', 'dollar_off', 'buy_x_get_y'];
const promoStatuses = ['draft', 'active', 'paused', 'expired'];

const idParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

const itemParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  itemId: z.string().trim().min(1, 'itemId is required'),
});

const promotionItemSchema = z.object({
  product_id: z.string().trim().min(1).optional().nullable(),
  category_id: z.string().trim().min(1).optional().nullable(),
  value: z.coerce.number().min(0, 'value must be >= 0'),
}).refine((body) => body.product_id || body.category_id, {
  message: 'product_id or category_id is required',
});

const promotionBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(160),
  promo_type: z.enum(promoTypes),
  status: z.enum(promoStatuses).optional().default('draft'),
  start_date: z.string().trim().min(1, 'start_date is required'),
  end_date: z.string().trim().min(1).optional().nullable(),
  items: z.array(promotionItemSchema).max(500).optional().default([]),
});

const promotionPatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  promo_type: z.enum(promoTypes).optional(),
  status: z.enum(promoStatuses).optional(),
  start_date: z.string().trim().min(1).optional(),
  end_date: z.string().trim().min(1).optional().nullable(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one promotion field is required',
});

const activeQuerySchema = z.object({
  date: z.string().trim().optional(),
});

function scopedRows(rows, context) {
  return filterRowsByContext(rows || [], context);
}

function dateInRange(row, date) {
  const current = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const start = row?.start_date ? String(row.start_date).slice(0, 10) : null;
  const end = row?.end_date ? String(row.end_date).slice(0, 10) : null;
  if (start && start > current) return false;
  if (end && end < current) return false;
  return true;
}

async function loadPromotionItems(promotionIds, context) {
  const ids = (promotionIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const { data, error } = await scopeQueryByContext(
    supabase.from('promotion_items').select('*'),
    context,
  ).in('promotion_id', ids);
  if (error) throw error;

  const byPromotion = new Map();
  for (const item of scopedRows(data, context)) {
    const key = String(item.promotion_id);
    const rows = byPromotion.get(key) || [];
    rows.push(item);
    byPromotion.set(key, rows);
  }
  return byPromotion;
}

async function listPromotions(context, filters = {}) {
  let query = scopeQueryByContext(
    supabase.from('promotions').select('*'),
    context,
  );
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query.order('start_date', { ascending: false });
  if (error) throw error;
  let rows = scopedRows(data, context);
  if (filters.activeDate) rows = rows.filter((row) => dateInRange(row, filters.activeDate));
  const itemsByPromotion = await loadPromotionItems(rows.map((row) => row.id), context);
  return rows.map((row) => ({
    ...row,
    items: itemsByPromotion.get(String(row.id)) || [],
  }));
}

router.get('/active', authenticateToken, promotionReaders, validateQuery(activeQuerySchema), async (req, res) => {
  try {
    const promotions = await listPromotions(req.context, {
      status: 'active',
      activeDate: req.validated.query.date || new Date().toISOString().slice(0, 10),
    });
    res.json({ promotions });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load active promotions' });
  }
});

router.get('/', authenticateToken, promotionReaders, async (req, res) => {
  try {
    res.json({ promotions: await listPromotions(req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load promotions' });
  }
});

router.post('/', authenticateToken, promotionManagers, validateBody(promotionBodySchema), async (req, res) => {
  try {
    const body = req.validated.body;
    const promoResult = await insertRecordWithOptionalScope(supabase, 'promotions', {
      name: body.name,
      promo_type: body.promo_type,
      status: body.status,
      start_date: body.start_date,
      end_date: body.end_date || null,
    }, req.context);
    if (promoResult.error) throw promoResult.error;

    const items = [];
    for (const item of body.items || []) {
      const itemResult = await insertRecordWithOptionalScope(supabase, 'promotion_items', {
        promotion_id: promoResult.data.id,
        product_id: item.product_id || null,
        category_id: item.category_id || null,
        value: item.value,
      }, req.context);
      if (itemResult.error) throw itemResult.error;
      items.push(itemResult.data);
    }

    res.status(201).json({ promotion: { ...promoResult.data, items } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create promotion' });
  }
});

router.get('/:id', authenticateToken, promotionReaders, validateParams(idParamsSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('promotions').select('*'),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .limit(1);
    if (error) throw error;
    const promotion = scopedRows(data, req.context)[0] || null;
    if (!promotion) return res.status(404).json({ error: 'Promotion not found' });
    const itemsByPromotion = await loadPromotionItems([promotion.id], req.context);
    res.json({ promotion: { ...promotion, items: itemsByPromotion.get(String(promotion.id)) || [] } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load promotion' });
  }
});

router.patch('/:id', authenticateToken, promotionManagers, validateParams(idParamsSchema), validateBody(promotionPatchSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('promotions').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Promotion not found' });
    res.json({ promotion: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update promotion' });
  }
});

router.delete('/:id', authenticateToken, promotionManagers, validateParams(idParamsSchema), async (req, res) => {
  try {
    const { error: itemsError } = await scopeQueryByContext(
      supabase.from('promotion_items').delete(),
      req.context,
    ).eq('promotion_id', req.validated.params.id);
    if (itemsError) throw itemsError;

    const { data, error } = await scopeQueryByContext(
      supabase.from('promotions').delete(),
      req.context,
    ).eq('id', req.validated.params.id);
    if (error) throw error;
    res.json({ deleted: true, rows: Array.isArray(data) ? data.length : 0 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete promotion' });
  }
});

router.post('/:id/items', authenticateToken, promotionManagers, validateParams(idParamsSchema), validateBody(promotionItemSchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'promotion_items', {
      promotion_id: req.validated.params.id,
      product_id: req.validated.body.product_id || null,
      category_id: req.validated.body.category_id || null,
      value: req.validated.body.value,
    }, req.context);
    if (result.error) throw result.error;
    res.status(201).json({ item: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create promotion item' });
  }
});

router.patch('/:id/items/:itemId', authenticateToken, promotionManagers, validateParams(itemParamsSchema), validateBody(promotionItemSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('promotion_items').update({
        product_id: req.validated.body.product_id || null,
        category_id: req.validated.body.category_id || null,
        value: req.validated.body.value,
      }),
      req.context,
    )
      .eq('promotion_id', req.validated.params.id)
      .eq('id', req.validated.params.itemId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Promotion item not found' });
    res.json({ item: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update promotion item' });
  }
});

router.delete('/:id/items/:itemId', authenticateToken, promotionManagers, validateParams(itemParamsSchema), async (req, res) => {
  try {
    const { error } = await scopeQueryByContext(
      supabase.from('promotion_items').delete(),
      req.context,
    )
      .eq('promotion_id', req.validated.params.id)
      .eq('id', req.validated.params.itemId);
    if (error) throw error;
    res.json({ deleted: true, id: req.validated.params.itemId });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete promotion item' });
  }
});

module.exports = router;
