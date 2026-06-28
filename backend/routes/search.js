'use strict';

/**
 * Global search for the Cmd/Ctrl+K command palette.
 * Company-scoped via req.context. Searches orders (#/customer), customers,
 * invoices (#), SKUs, and lot numbers. Returns results grouped by type.
 */

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { filterRowsByContext, isMissingColumnError, scopeQueryByContext } = require('../services/operating-context');

const router = express.Router();
const PER_TYPE_LIMIT = 6;

function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, (m) => `\\${m}`);
}

function dedupeById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = String(row?.id ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function searchIlikeScoped(table, select, fields, like, context, options = {}) {
  const results = await Promise.all(fields.map(async (field) => {
    let { data, error } = await scopeQueryByContext(
      supabase.from(table).select(select),
      context,
    ).ilike(field, like).limit(PER_TYPE_LIMIT);
    if (error && options.fallbackSelect && isMissingColumnError(error)) {
      const retry = await scopeQueryByContext(
        supabase.from(table).select(options.fallbackSelect),
        context,
      ).ilike(field, like).limit(PER_TYPE_LIMIT);
      data = retry.data;
      error = retry.error;
    }
    if (error) return [];
    return filterRowsByContext(data || [], context);
  }));
  return dedupeById(results.flat()).slice(0, PER_TYPE_LIMIT);
}

async function loadProductImageUrls(productIds, context) {
  if (!productIds.length) return new Map();
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('product_media').select('id,product_id,url,sort_order,company_id,deleted_at'),
      context,
      { companyField: 'company_id' },
    )
      .in('product_id', productIds)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true });
    if (error) return new Map();

    const imageByProduct = new Map();
    for (const media of filterRowsByContext(data || [], context)) {
      const productId = String(media.product_id || '');
      if (productId && media.url && !imageByProduct.has(productId)) {
        imageByProduct.set(productId, media.url);
      }
    }
    return imageByProduct;
  } catch {
    return new Map();
  }
}

function customerImageUrl(customer) {
  return customer?.avatar_url || customer?.image_url || customer?.logo_url || customer?.photo_url || null;
}

router.get('/', authenticateToken, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, groups: [] });
  const like = `%${escapeLike(q)}%`;

  const [orders, customers, invoices, products, lots] = await Promise.all([
    searchIlikeScoped(
      'orders',
      'id,order_number,customer_name,status,company_id,location_id',
      ['order_number', 'customer_name'],
      like,
      req.context,
    ),
    searchIlikeScoped(
      'Customers',
      'id,company_name,billing_email,avatar_url,company_id,location_id',
      ['company_name'],
      like,
      req.context,
      { fallbackSelect: 'id,company_name,billing_email,company_id,location_id' },
    ),
    searchIlikeScoped(
      'invoices',
      'id,invoice_number,customer_name,status,company_id,location_id',
      ['invoice_number', 'customer_name'],
      like,
      req.context,
    ),
    searchIlikeScoped(
      'products',
      'id,item_number,description,company_id,location_id',
      ['item_number', 'description'],
      like,
      req.context,
    ),
    searchIlikeScoped(
      'lot_codes',
      'id,lot_number,product_id,company_id,location_id',
      ['lot_number'],
      like,
      req.context,
    ),
  ]);
  const productImages = await loadProductImageUrls(products.map((p) => p.id).filter(Boolean), req.context);

  const groups = [];
  if (orders.length) groups.push({
    type: 'order', label: 'Orders',
    results: orders.map((o) => ({ id: o.id, title: o.order_number || o.id.slice(0, 8), subtitle: o.customer_name || '', path: `/orders?orderId=${o.id}` })),
  });
  if (customers.length) groups.push({
    type: 'customer', label: 'Customers',
    results: customers.map((c) => ({
      id: String(c.id),
      title: c.company_name || `Customer ${c.id}`,
      subtitle: c.billing_email || '',
      path: `/customers?customerId=${c.id}`,
      image_url: customerImageUrl(c),
    })),
  });
  if (invoices.length) groups.push({
    type: 'invoice', label: 'Invoices',
    results: invoices.map((i) => ({ id: i.id, title: i.invoice_number || i.id.slice(0, 8), subtitle: i.customer_name || '', path: `/invoices?invoiceId=${i.id}` })),
  });
  if (products.length) groups.push({
    type: 'sku', label: 'SKUs',
    results: products.map((p) => ({
      id: p.id,
      title: p.item_number || p.description || p.id.slice(0, 8),
      subtitle: p.description || '',
      path: `/inventory?search=${encodeURIComponent(p.item_number || p.description || '')}`,
      image_url: productImages.get(String(p.id)) || null,
    })),
  });
  if (lots.length) groups.push({
    type: 'lot', label: 'Lot Numbers',
    results: lots.map((l) => ({ id: l.id, title: l.lot_number, subtitle: 'Lot', path: `/traceability?lot=${encodeURIComponent(l.lot_number)}` })),
  });

  res.json({ query: q, groups });
});

module.exports = router;
