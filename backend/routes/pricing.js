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
const pricingEngine = require('../services/pricing-engine');

const router = express.Router();
const pricingReaders = requireRole('admin', 'manager', 'rep');
const pricingManagers = requireRole('admin', 'manager');

const idParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

const priceLevelBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

const specialQuerySchema = z.object({
  customerId: z.string().trim().min(1, 'customerId is required'),
});

const specialBodySchema = z.object({
  customer_id: z.string().trim().min(1, 'customer_id is required'),
  product_id: z.string().trim().min(1, 'product_id is required'),
  special_price: z.coerce.number().min(0, 'special_price must be >= 0'),
  effective_date: z.string().trim().min(1).optional(),
  expiry_date: z.string().trim().min(1).optional().nullable(),
});

const resolveQuerySchema = z.object({
  customerId: z.string().trim().min(1, 'customerId is required'),
  productId: z.string().trim().min(1, 'productId is required'),
  qty: z.coerce.number().min(0).optional().default(1),
  uom: z.string().trim().optional().default(''),
  date: z.string().trim().optional(),
});

const quoteItemSchema = z.object({
  product_id: z.string().trim().min(1, 'product_id is required'),
  quoted_price: z.coerce.number().min(0, 'quoted_price must be >= 0'),
  min_qty: z.coerce.number().min(0).optional().nullable(),
  uom: z.string().trim().max(50).optional().nullable(),
});

const quoteBodySchema = z.object({
  customer_id: z.string().trim().min(1, 'customer_id is required'),
  status: z.enum(['draft', 'active', 'expired', 'cancelled']).optional().default('draft'),
  valid_from: z.string().trim().min(1).optional(),
  valid_until: z.string().trim().min(1).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(quoteItemSchema).max(200).optional().default([]),
});

const quotePatchSchema = z.object({
  status: z.enum(['draft', 'active', 'expired', 'cancelled']).optional(),
  valid_from: z.string().trim().min(1).optional(),
  valid_until: z.string().trim().min(1).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one quote field is required',
});

const rebateBodySchema = z.object({
  vendor_id: z.string().trim().min(1).optional().nullable(),
  customer_id: z.string().trim().min(1).optional().nullable(),
  name: z.string().trim().min(1, 'name is required').max(160),
  rebate_type: z.enum(['percent', 'dollar', 'per_unit']),
  value: z.coerce.number().min(0, 'value must be >= 0'),
  period_start: z.string().trim().min(1, 'period_start is required'),
  period_end: z.string().trim().min(1, 'period_end is required'),
});

const minimumSellRuleBodySchema = z.object({
  product_id: z.string().trim().min(1).optional().nullable(),
  category_id: z.string().trim().min(1).optional().nullable(),
  min_margin_pct: z.coerce.number().min(0).max(99.99).optional().nullable(),
  min_price: z.coerce.number().min(0).optional().nullable(),
}).refine((body) => body.product_id || body.category_id, {
  message: 'product_id or category_id is required',
}).refine((body) => body.min_margin_pct != null || body.min_price != null, {
  message: 'min_margin_pct or min_price is required',
});

function scopedRows(rows, context) {
  return filterRowsByContext(rows || [], context);
}

async function loadQuoteItems(quoteIds, context) {
  const ids = (quoteIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const { data, error } = await scopeQueryByContext(
    supabase.from('quote_items').select('*'),
    context,
  ).in('quote_id', ids);
  if (error) throw error;
  const byQuote = new Map();
  for (const item of scopedRows(data, context)) {
    const key = String(item.quote_id);
    const rows = byQuote.get(key) || [];
    rows.push(item);
    byQuote.set(key, rows);
  }
  return byQuote;
}

router.get('/levels', authenticateToken, pricingReaders, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('price_levels').select('*'),
      req.context,
    ).order('name', { ascending: true });
    if (error) throw error;
    res.json({ price_levels: scopedRows(data, req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load price levels' });
  }
});

router.post('/levels', authenticateToken, pricingManagers, validateBody(priceLevelBodySchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'price_levels', req.validated.body, req.context);
    if (result.error) throw result.error;
    res.status(201).json({ price_level: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create price level' });
  }
});

router.patch('/levels/:id', authenticateToken, pricingManagers, validateParams(idParamsSchema), validateBody(priceLevelBodySchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('price_levels').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Price level not found' });
    res.json({ price_level: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update price level' });
  }
});

router.get('/special', authenticateToken, pricingReaders, validateQuery(specialQuerySchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('customer_special_prices').select('*'),
      req.context,
    )
      .eq('customer_id', req.validated.query.customerId)
      .order('effective_date', { ascending: false });
    if (error) throw error;
    res.json({ specials: scopedRows(data, req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load customer special prices' });
  }
});

router.post('/special', authenticateToken, pricingManagers, validateBody(specialBodySchema), async (req, res) => {
  try {
    const body = req.validated.body;
    const { data: existingRows, error: existingErr } = await scopeQueryByContext(
      supabase.from('customer_special_prices').select('*'),
      req.context,
    )
      .eq('customer_id', body.customer_id)
      .eq('product_id', body.product_id)
      .limit(1);
    if (existingErr) throw existingErr;
    const existing = scopedRows(existingRows, req.context)[0] || null;
    const payload = {
      customer_id: body.customer_id,
      product_id: body.product_id,
      special_price: body.special_price,
      effective_date: body.effective_date || new Date().toISOString().slice(0, 10),
      expiry_date: body.expiry_date || null,
    };

    let result;
    if (existing) {
      result = await scopeQueryByContext(
        supabase.from('customer_special_prices').update(payload),
        req.context,
      )
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await insertRecordWithOptionalScope(supabase, 'customer_special_prices', payload, req.context);
    }

    if (result.error) throw result.error;
    res.json({ special: result.data || { ...existing, ...payload } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save customer special price' });
  }
});

router.get('/resolve', authenticateToken, pricingReaders, validateQuery(resolveQuerySchema), async (req, res) => {
  try {
    const query = req.validated.query;
    const result = await pricingEngine.resolvePrice({
      db: supabase,
      customerId: query.customerId,
      productId: query.productId,
      qty: query.qty,
      uom: query.uom,
      context: req.context,
      onDate: query.date,
    });
    const minimumSell = await pricingEngine.enforceMinimumSell({
      db: supabase,
      price: result.price,
      productId: query.productId,
      context: req.context,
    });
    res.json({
      ...result,
      minimum_sell: minimumSell,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to resolve price' });
  }
});

router.get('/quotes', authenticateToken, pricingReaders, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('quotes').select('*'),
      req.context,
    ).order('created_at', { ascending: false });
    if (error) throw error;
    const quotes = scopedRows(data, req.context);
    const itemsByQuote = await loadQuoteItems(quotes.map((quote) => quote.id), req.context);
    res.json({
      quotes: quotes.map((quote) => ({
        ...quote,
        items: itemsByQuote.get(String(quote.id)) || [],
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load quotes' });
  }
});

router.post('/quotes', authenticateToken, pricingManagers, validateBody(quoteBodySchema), async (req, res) => {
  try {
    const body = req.validated.body;
    const quotePayload = {
      customer_id: body.customer_id,
      status: body.status,
      valid_from: body.valid_from || new Date().toISOString().slice(0, 10),
      valid_until: body.valid_until || null,
      notes: body.notes || null,
      created_by: req.user?.id || null,
    };
    const quoteResult = await insertRecordWithOptionalScope(supabase, 'quotes', quotePayload, req.context);
    if (quoteResult.error) throw quoteResult.error;
    const quote = quoteResult.data;

    const items = [];
    for (const item of body.items || []) {
      const itemResult = await insertRecordWithOptionalScope(supabase, 'quote_items', {
        quote_id: quote.id,
        product_id: item.product_id,
        quoted_price: item.quoted_price,
        min_qty: item.min_qty ?? null,
        uom: item.uom || null,
      }, req.context);
      if (itemResult.error) throw itemResult.error;
      items.push(itemResult.data);
    }

    res.status(201).json({ quote: { ...quote, items } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create quote' });
  }
});

router.patch('/quotes/:id', authenticateToken, pricingManagers, validateParams(idParamsSchema), validateBody(quotePatchSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('quotes').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Quote not found' });
    res.json({ quote: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update quote' });
  }
});

router.get('/rebates', authenticateToken, pricingReaders, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('rebates').select('*'),
      req.context,
    ).order('period_start', { ascending: false });
    if (error) throw error;
    res.json({ rebates: scopedRows(data, req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load rebates' });
  }
});

router.post('/rebates', authenticateToken, pricingManagers, validateBody(rebateBodySchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'rebates', req.validated.body, req.context);
    if (result.error) throw result.error;
    res.status(201).json({ rebate: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create rebate' });
  }
});

router.patch('/rebates/:id', authenticateToken, pricingManagers, validateParams(idParamsSchema), validateBody(rebateBodySchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('rebates').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Rebate not found' });
    res.json({ rebate: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update rebate' });
  }
});

router.get('/minimum-sell-rules', authenticateToken, pricingReaders, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('minimum_sell_rules').select('*'),
      req.context,
    ).order('id', { ascending: true });
    if (error) throw error;
    res.json({ rules: scopedRows(data, req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load minimum sell rules' });
  }
});

router.post('/minimum-sell-rules', authenticateToken, pricingManagers, validateBody(minimumSellRuleBodySchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'minimum_sell_rules', req.validated.body, req.context);
    if (result.error) throw result.error;
    res.status(201).json({ rule: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create minimum sell rule' });
  }
});

router.patch('/minimum-sell-rules/:id', authenticateToken, pricingManagers, validateParams(idParamsSchema), validateBody(minimumSellRuleBodySchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('minimum_sell_rules').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Minimum sell rule not found' });
    res.json({ rule: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update minimum sell rule' });
  }
});

module.exports = router;
