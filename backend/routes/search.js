'use strict';

/**
 * Global search for the Cmd/Ctrl+K command palette.
 * Company-scoped via req.context. Searches orders (#/customer), customers,
 * invoices (#), SKUs, and lot numbers. Returns results grouped by type.
 */

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { filterRowsByContext, scopeQueryByContext } = require('../services/operating-context');

const router = express.Router();
const PER_TYPE_LIMIT = 6;

function escapeLike(value) {
  return String(value).replace(/[%_]/g, (m) => `\\${m}`);
}

router.get('/', authenticateToken, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, groups: [] });
  const like = `%${escapeLike(q)}%`;

  async function run(builder) {
    try {
      const { data, error } = await builder;
      if (error) return [];
      return filterRowsByContext(data || [], req.context);
    } catch {
      return [];
    }
  }

  const [orders, customers, invoices, products, lots] = await Promise.all([
    run(scopeQueryByContext(supabase.from('orders').select('id,order_number,customer_name,status,company_id,location_id'), req.context)
      .or(`order_number.ilike.${like},customer_name.ilike.${like}`).limit(PER_TYPE_LIMIT)),
    run(scopeQueryByContext(supabase.from('Customers').select('id,company_name,billing_email,company_id,location_id'), req.context)
      .ilike('company_name', like).limit(PER_TYPE_LIMIT)),
    run(scopeQueryByContext(supabase.from('invoices').select('id,invoice_number,customer_name,status,company_id,location_id'), req.context)
      .or(`invoice_number.ilike.${like},customer_name.ilike.${like}`).limit(PER_TYPE_LIMIT)),
    run(scopeQueryByContext(supabase.from('products').select('id,item_number,description,company_id,location_id'), req.context)
      .or(`item_number.ilike.${like},description.ilike.${like}`).limit(PER_TYPE_LIMIT)),
    run(scopeQueryByContext(supabase.from('lot_codes').select('id,lot_number,product_id,company_id,location_id'), req.context)
      .ilike('lot_number', like).limit(PER_TYPE_LIMIT)),
  ]);

  const groups = [];
  if (orders.length) groups.push({
    type: 'order', label: 'Orders',
    results: orders.map((o) => ({ id: o.id, title: o.order_number || o.id.slice(0, 8), subtitle: o.customer_name || '', path: `/orders?orderId=${o.id}` })),
  });
  if (customers.length) groups.push({
    type: 'customer', label: 'Customers',
    results: customers.map((c) => ({ id: String(c.id), title: c.company_name || `Customer ${c.id}`, subtitle: c.billing_email || '', path: `/customers?customerId=${c.id}` })),
  });
  if (invoices.length) groups.push({
    type: 'invoice', label: 'Invoices',
    results: invoices.map((i) => ({ id: i.id, title: i.invoice_number || i.id.slice(0, 8), subtitle: i.customer_name || '', path: `/invoices?invoiceId=${i.id}` })),
  });
  if (products.length) groups.push({
    type: 'sku', label: 'SKUs',
    results: products.map((p) => ({ id: p.id, title: p.item_number || p.description || p.id.slice(0, 8), subtitle: p.description || '', path: `/inventory?search=${encodeURIComponent(p.item_number || p.description || '')}` })),
  });
  if (lots.length) groups.push({
    type: 'lot', label: 'Lot Numbers',
    results: lots.map((l) => ({ id: l.id, title: l.lot_number, subtitle: 'Lot', path: `/traceability?lot=${encodeURIComponent(l.lot_number)}` })),
  });

  res.json({ query: q, groups });
});

module.exports = router;
