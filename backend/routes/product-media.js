'use strict';

const express = require('express');
const net = require('node:net');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const config = require('../lib/config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../lib/zod-validate');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');

const router = express.Router();
const mediaRoles = requireRole('admin', 'manager', 'rep');
const MAX_MEDIA_PER_PRODUCT = 10;

const productMediaQuerySchema = z.object({
  productId: z.string().trim().min(1, 'productId is required'),
});

const productMediaParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

const productMediaCreateSchema = z.object({
  product_id: z.string().trim().min(1, 'product_id is required'),
  media_type: z.enum(['image', 'library', 'url']).default('image'),
  url: z.string().trim().url('url must be an absolute URL'),
  label: z.string().trim().max(120).optional().default(''),
  sort_order: z.coerce.number().int().min(0).max(999).optional().default(0),
});

const productMediaPatchSchema = z.object({
  label: z.string().trim().max(120).optional(),
  sort_order: z.coerce.number().int().min(0).max(999).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function isPrivateOrLocalHost(hostname) {
  const host = normalizeHost(hostname).replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  if (net.isIP(host) === 4) {
    const parts = host.split('.').map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (net.isIP(host) === 6) {
    const compact = host.toLowerCase();
    return (
      compact === '::1' ||
      compact === '0:0:0:0:0:0:0:1' ||
      compact.startsWith('fc') ||
      compact.startsWith('fd') ||
      compact.startsWith('fe80:')
    );
  }

  return false;
}

function isAllowedImageUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (isPrivateOrLocalHost(parsed.hostname)) return false;
  const host = normalizeHost(parsed.hostname);
  return config.ALLOWED_IMAGE_HOSTS.some((allowed) => normalizeHost(allowed) === host);
}

async function loadProductForContext(productId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('products').select('id,company_id,location_id'),
    context,
  )
    .eq('id', productId)
    .limit(1);
  if (error) throw error;
  return filterRowsByContext(data || [], context)[0] || null;
}

async function loadMediaForContext(productId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('product_media').select('*'),
    context,
    { companyField: 'company_id' },
  )
    .eq('product_id', productId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return filterRowsByContext(data || [], context);
}

router.get('/', authenticateToken, mediaRoles, validateQuery(productMediaQuerySchema), async (req, res) => {
  try {
    const productId = req.validated.query.productId;
    const product = await loadProductForContext(productId, req.context);
    if (!product) return res.json({ media: [] });

    const media = await loadMediaForContext(productId, req.context);
    res.json({ media });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load product media' });
  }
});

router.post('/', authenticateToken, mediaRoles, validateBody(productMediaCreateSchema), async (req, res) => {
  try {
    const body = req.validated.body;
    if (!isAllowedImageUrl(body.url)) {
      return res.status(400).json({ error: 'Image host is not allowed' });
    }

    const product = await loadProductForContext(body.product_id, req.context);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const current = await loadMediaForContext(body.product_id, req.context);
    if (current.length >= MAX_MEDIA_PER_PRODUCT) {
      return res.status(400).json({ error: 'A product can have a maximum of 10 active media items' });
    }

    const result = await insertRecordWithOptionalScope(supabase, 'product_media', {
      product_id: body.product_id,
      media_type: body.media_type,
      url: body.url,
      label: body.label,
      sort_order: body.sort_order,
      deleted_at: null,
    }, req.context);

    if (result.error) throw result.error;
    res.status(201).json({ media: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create product media' });
  }
});

router.patch('/:id', authenticateToken, mediaRoles, validateParams(productMediaParamsSchema), validateBody(productMediaPatchSchema), async (req, res) => {
  try {
    const patch = { ...req.validated.body };
    const { data, error } = await scopeQueryByContext(
      supabase.from('product_media').update(patch),
      req.context,
      { companyField: 'company_id' },
    )
      .eq('id', req.validated.params.id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product media not found' });
    res.json({ media: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update product media' });
  }
});

router.delete('/:id', authenticateToken, mediaRoles, validateParams(productMediaParamsSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('product_media').update({ deleted_at: new Date().toISOString() }),
      req.context,
      { companyField: 'company_id' },
    )
      .eq('id', req.validated.params.id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product media not found' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete product media' });
  }
});

router.isAllowedImageUrl = isAllowedImageUrl;

module.exports = router;
