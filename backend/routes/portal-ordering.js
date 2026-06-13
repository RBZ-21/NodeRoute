'use strict';

/**
 * Customer Portal Ordering (paid add-on)
 * ──────────────────────────────────────
 * Catalog browse + cart submit + one-tap reorder for portal customers, gated
 * behind companies.portal_ordering_enabled. Every endpoint runs
 * requirePortalOrdering after authenticatePortalToken, so a company without
 * the add-on always receives 403 FEATURE_NOT_ENABLED.
 *
 * All queries are scoped to the authenticated portal customer's company via
 * req.portalContext (filterRowsByContext / buildScopeFields), so there is no
 * cross-company data leakage. No delivery-window selection is exposed anywhere.
 */

const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../services/supabase');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Stock state shown to the customer. Out-of-stock items are visible but the
// client must not allow adding them; we also re-validate on submit.
function stockState(product) {
  const qty = toNumber(product.on_hand_qty, 0);
  if (qty <= 0) return 'out_of_stock';
  if (qty <= 10) return 'limited';
  return 'in_stock';
}

// Standard pricing. Customer-specific negotiated pricing does not exist in this
// schema, so the standard catalog price is used (spec: fall back to standard).
function catalogPrice(product) {
  return toNumber(product.price_per_unit ?? product.cost, 0);
}

function toCatalogItem(product) {
  return {
    id: product.id,
    item_number: product.item_number,
    name: product.description || product.name,
    category: product.category || null,
    unit: product.unit || product.default_unit || 'each',
    price: catalogPrice(product),
    stock_state: stockState(product),
    addable: stockState(product) !== 'out_of_stock',
  };
}

module.exports = function buildPortalOrderingRouter({ authenticatePortalToken, requirePortalOrdering }) {
  const router = express.Router();

  // Apply auth + feature gate to every route in this sub-router.
  router.use(authenticatePortalToken, requirePortalOrdering);

  // GET /api/portal/catalog — live in-stock (or limited) catalog.
  router.get('/catalog', async (req, res) => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or('is_active.is.null,is_active.eq.true')
      .order('category', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    // Scope to the customer's company, then expose only presentation fields
    // (no cost internals, no other tenant rows).
    const scoped = filterRowsByContext(data || [], req.portalContext);
    res.json(scoped.map(toCatalogItem));
  });

  // POST /api/portal/orders/submit — create a pending portal order.
  router.post('/orders/submit', async (req, res) => {
    const lines = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!lines.length) return res.status(400).json({ error: 'Cart is empty.' });

    // Load the company catalog once to validate items + price server-side
    // (never trust client-supplied prices or stock state).
    const { data: products, error: prodError } = await supabase
      .from('products')
      .select('*')
      .or('is_active.is.null,is_active.eq.true');
    if (prodError) return res.status(500).json({ error: prodError.message });
    const catalog = filterRowsByContext(products || [], req.portalContext);
    const byId = new Map(catalog.map((p) => [String(p.id), p]));
    const byItemNumber = new Map(catalog.map((p) => [String(p.item_number || '').trim().toLowerCase(), p]));

    const items = [];
    for (const line of lines) {
      const qty = toNumber(line.quantity ?? line.qty, 0);
      if (qty <= 0) continue;
      const product = byId.get(String(line.product_id ?? line.id))
        || byItemNumber.get(String(line.item_number || '').trim().toLowerCase());
      if (!product) return res.status(422).json({ error: `Item not found in catalog: ${line.item_number || line.product_id || 'unknown'}` });
      if (stockState(product) === 'out_of_stock') {
        return res.status(422).json({ error: `${product.description || product.name} is out of stock and cannot be ordered.`, code: 'OUT_OF_STOCK' });
      }
      items.push({
        product_id: product.id,
        item_number: product.item_number,
        name: product.description || product.name,
        unit: product.unit || product.default_unit || 'each',
        quantity: qty,
        unit_price: catalogPrice(product),
        notes: String(line.notes || '').slice(0, 500) || null,
      });
    }
    if (!items.length) return res.status(400).json({ error: 'No valid items with quantity greater than 0.' });

    const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
    const trackingToken = crypto.randomBytes(18).toString('hex');
    const insertResult = await insertRecordWithOptionalScope(supabase, 'orders', {
      order_number: orderNumber,
      customer_name: req.customerName || req.customerEmail,
      customer_email: (req.customerEmail || '').toLowerCase() || null,
      items,
      charges: [],
      status: 'pending',
      source: 'portal',
      notes: String(req.body?.notes || '').slice(0, 1000) || null,
      tracking_token: trackingToken,
    }, req.portalContext);
    if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });

    res.json({
      id: insertResult.data.id,
      order_number: insertResult.data.order_number,
      status: insertResult.data.status,
      source: insertResult.data.source,
      items: insertResult.data.items,
    });
  });

  // POST /api/portal/orders/:id/reorder — one-tap reorder from a past order.
  router.post('/orders/:id/reorder', async (req, res) => {
    const { data: past, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .eq('customer_email', (req.customerEmail || '').toLowerCase())
      .single();
    if (error || !past) return res.status(404).json({ error: 'Order not found' });
    if (!filterRowsByContext([past], req.portalContext).length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Re-validate every line against the current catalog: drop discontinued or
    // out-of-stock items, refresh prices.
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .or('is_active.is.null,is_active.eq.true');
    const catalog = filterRowsByContext(products || [], req.portalContext);
    const byItemNumber = new Map(catalog.map((p) => [String(p.item_number || '').trim().toLowerCase(), p]));

    const items = [];
    const skipped = [];
    for (const line of (past.items || [])) {
      const product = byItemNumber.get(String(line.item_number || '').trim().toLowerCase());
      if (!product || stockState(product) === 'out_of_stock') {
        skipped.push(line.name || line.item_number);
        continue;
      }
      items.push({
        product_id: product.id,
        item_number: product.item_number,
        name: product.description || product.name,
        unit: product.unit || product.default_unit || 'each',
        quantity: toNumber(line.quantity ?? line.qty, 1),
        unit_price: catalogPrice(product),
        notes: line.notes || null,
      });
    }
    if (!items.length) return res.status(422).json({ error: 'None of the items on that order are currently available to reorder.', skipped });

    const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
    const trackingToken = crypto.randomBytes(18).toString('hex');
    const insertResult = await insertRecordWithOptionalScope(supabase, 'orders', {
      order_number: orderNumber,
      customer_name: req.customerName || req.customerEmail,
      customer_email: (req.customerEmail || '').toLowerCase() || null,
      items,
      charges: [],
      status: 'pending',
      source: 'portal',
      notes: `Reorder of ${past.order_number || past.id}`,
      tracking_token: trackingToken,
    }, req.portalContext);
    if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });

    res.json({
      id: insertResult.data.id,
      order_number: insertResult.data.order_number,
      status: insertResult.data.status,
      source: insertResult.data.source,
      items: insertResult.data.items,
      skipped,
    });
  });

  return router;
};
